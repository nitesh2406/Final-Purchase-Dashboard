/**
 * ===================================================================
 * AmazonForecasting.gs
 * Amazon FBA Forecasting — Core Logic
 * ===================================================================
 *
 * Implements the 9-step Amazon FBA shipment quantity calculation.
 *
 * STEP 1  — Calculate Amazon MMA per Channel SKU (90-day weighted avg)
 * STEP 2  — Calculate Days of Cover (DOC) per Channel SKU
 * STEP 3  — Target coverage check (DOC > threshold → skip)
 * STEP 4  — Calculated replenishment quantity
 * STEP 5  — Minimum shipment rules by velocity band
 * STEP 6  — Warehouse availability check per Master SKU
 * STEP 7  — Inventory split + shipment quantity decision
 * STEP 8  — Combo/kitting SKU special handling
 * STEP 9  — Final output → Shipping Plan Quantity
 *
 * Data sources:
 *   SKU Mapping      → Channel SKU ↔ Master SKU linkage
 *   Sales Data       → Amazon + Shopify channel sales
 *   Inventory Data   → AMAZON + EASY ECOM channel inventory
 *   EE Product Master → Pack Size, Cost, MRP, YEIO_Reserve, combo flag
 *   EE Component Master → Combo/kit detection
 *
 * Output:
 *   Returns per-Channel-SKU array to the frontend API
 *   Also writes to Amazon_Shipment_Plan sheet when confirmed
 *
 * Dependencies:
 *   AmazonConfig.gs   → getAmazonConfig()
 *   InventoryForecasting.gs → getSheetData(), getValue(), buildHeaderMap(),
 *                             HEADER_MAPS, CACHE, SHEETS, ArrayOfRow()
 * ===================================================================
 */

// ─── SHEET NAME CONSTANTS ─────────────────────────────────────────
// These match the actual tab names in the Google Spreadsheet.
const AMAZON_SHEETS = {
  sku_mapping: 'SKU Mapping',          // Channel SKU ↔ Master SKU
  products:    'EE Product Master',
  components:  'EE Component Master',
  sales:       'Sales Data',
  inventory:   'Inventory Data',
};

// ─── ROUNDING HELPERS ─────────────────────────────────────────────
const ri  = v => Math.round(v  || 0);          // integer
const r2  = v => Math.round((v || 0) * 100) / 100; // 2 decimal places
//const rUp = (v, to) => Math.ceil(v / to) * to; // round up to nearest multiple
const rUp   = (v, to) => Math.ceil(v  / to) * to;
const rDown = (v, to) => Math.floor(v / to) * to;
const rRound = (v, to) => Math.round(v / to) * to;


// ===================================================================
// STEP 0 — DATA LOADERS
// ===================================================================

/**
 * Returns a Set of Master SKUs to exclude from Amazon forecasting.
 * Source: EE Product Master, column 'Exclude_List', value = 'Yes'
 */
function getAmazonExcludeSet() {
  const excludeSet = new Set();
  try {
    const data      = getSheetData(AMAZON_SHEETS.products);
    const sheetName = AMAZON_SHEETS.products;
    for (const row of data) {
      if (!ArrayOfRow(row)) continue;
      const masterSku   = getValue(row, sheetName, 'SKU') || '';
      const excludeFlag = (getValue(row, sheetName, 'Exclude_List') || '').trim().toUpperCase();
      if (masterSku && excludeFlag === 'YES') {
        excludeSet.add(masterSku);
      }
    }
    Logger.log('Amazon Exclude List: ' + excludeSet.size + ' SKUs excluded from EE Product Master');
  } catch (err) {
    Logger.log('getAmazonExcludeSet error: ' + err.message);
  }
  return excludeSet;
}


/**
 * Builds a Map of channelSku → masterSku for AMAZON channel.
 * Also builds a reverse Map: masterSku → [channelSku, ...]
 *
 * Source: SKU Mapping sheet, filter Channel Name = AMAZON
 */


function buildAmazonSkuMap(CONFIG) {
  const data       = getSheetData(AMAZON_SHEETS.sku_mapping);
  const sheetName  = AMAZON_SHEETS.sku_mapping;
  const channelFilter = CONFIG.AMAZON_CHANNEL_NAME;

  const channelToMaster = new Map(); // channelSku → masterSku
  const masterToChannels = new Map(); // masterSku  → [{ channelSku, channelItemCode }]

  for (const row of data) {
    if (!ArrayOfRow(row)) continue;

    const channelName     = getValue(row, sheetName, 'Channel Name') || '';
    const channelItemCode = getValue(row, sheetName, 'Channel Item Code') || '';
    const channelSku      = getValue(row, sheetName, 'SKU') || '';
    const masterSku       = getValue(row, sheetName, 'Master SKU') || '';
    const alternateSku    = getValue(row, sheetName, 'Alternate SKU') || '';
    //const channelExclusion = String(getValue(row, sheetName, 'Amazon Channel Exclusion') || '').trim().toUpperCase() === 'TRUE';
    const channelExclusion = String(getValue(row, sheetName, 'Amazon Channel SKU Exclusion') || '').trim().toUpperCase() === 'TRUE';
    if (!channelSku || !masterSku) continue;
    if (channelName.toUpperCase().trim() !== channelFilter.toUpperCase().trim()) continue;

    channelToMaster.set(channelSku, masterSku);

    if (!masterToChannels.has(masterSku)) masterToChannels.set(masterSku, []);
    //masterToChannels.get(masterSku).push({ channelSku, channelItemCode, alternateSku });
    masterToChannels.get(masterSku).push({ channelSku, channelItemCode, alternateSku, channelExclusion });


  }

  return { channelToMaster, masterToChannels };
}

/**
 * Loads and indexes Amazon sales data by Channel SKU.
 * Returns Map<channelSku, salesRows[]>
 *
 * Source: Sales Data, Channel Name = AMAZON
 */
function loadAmazonSalesMap(CONFIG) {
  const data      = getSheetData(AMAZON_SHEETS.sales);
  const sheetName = AMAZON_SHEETS.sales;
  const salesMap  = new Map(); // channelSku → [{ date, qty }]

  // const today      = new Date();
  // const cutoffDate = new Date(today.getTime() - CONFIG.AMAZON_SALES_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const today = new Date();

// Normalize today to midnight to avoid timezone drift
  today.setHours(0, 0, 0, 0);

// Exclude today — data not fully populated yet. History ends yesterday.
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

// Cutoff = start of (today - SALES_HISTORY_DAYS)
  const cutoffDate = new Date(today.getTime() - CONFIG.AMAZON_SALES_HISTORY_DAYS * 24 * 60 * 60 * 1000);

  for (const row of data) {
    if (!ArrayOfRow(row)) continue;

    const channelName = (getValue(row, sheetName, 'Channel Name') || '').toUpperCase().trim();
    if (channelName !== CONFIG.AMAZON_CHANNEL_NAME.toUpperCase().trim()) continue;

    const dateVal    = getValue(row, sheetName, 'Date');
    const channelSku = getValue(row, sheetName, 'Channel SKU') || '';
    const qty        = getValue(row, sheetName, 'Quantity', true);

    if (!channelSku || !dateVal || qty <= 0) continue;

    // const saleDate = new Date(dateVal);
    // if (isNaN(saleDate.getTime()) || saleDate < cutoffDate) continue;
    const saleDate = new Date(dateVal);
    saleDate.setHours(0, 0, 0, 0); // normalize to midnight
    if (isNaN(saleDate.getTime()) || saleDate < cutoffDate) continue;
    if (saleDate >= today) continue; // exclude today — data incomplete

    if (!salesMap.has(channelSku)) salesMap.set(channelSku, []);
    salesMap.get(channelSku).push({ date: saleDate, qty });
  }

  return salesMap;
}

/**
 * Loads and indexes Shopify sales by Master SKU.
 * Returns Map<masterSku, salesRows[]>
 *
 * Source: Sales Data, Channel Name = SHOPIFY
 * Note: Shopify uses Master SKU column directly.
 */
function loadShopifySalesMap(CONFIG) {
  const data      = getSheetData(AMAZON_SHEETS.sales);
  const sheetName = AMAZON_SHEETS.sales;
  const salesMap  = new Map(); // masterSku → [{ date, qty }]

  const today      = new Date();
  const cutoffDate = new Date(today.getTime() - CONFIG.AMAZON_SALES_HISTORY_DAYS * 24 * 60 * 60 * 1000);

  for (const row of data) {
    if (!ArrayOfRow(row)) continue;

    const channelName = (getValue(row, sheetName, 'Channel Name') || '').toUpperCase().trim();
    if (channelName !== CONFIG.SHOPIFY_CHANNEL_NAME.toUpperCase().trim()) continue;

    const dateVal   = getValue(row, sheetName, 'Date');
    const masterSku = getValue(row, sheetName, 'Master SKU') || '';
    const qty       = getValue(row, sheetName, 'Quantity', true);

    if (!masterSku || !dateVal || qty <= 0) continue;

    //const saleDate = new Date(dateVal);
    //if (isNaN(saleDate.getTime()) || saleDate < cutoffDate) continue;
    const saleDate = new Date(dateVal);
    saleDate.setHours(0, 0, 0, 0); // normalize to midnight
    if (isNaN(saleDate.getTime()) || saleDate < cutoffDate) continue;
    if (saleDate >= today) continue; // exclude today — data incomplete

    if (!salesMap.has(masterSku)) salesMap.set(masterSku, []);
    salesMap.get(masterSku).push({ date: saleDate, qty });
  }

  return salesMap;
}

/**
 * Loads and indexes Quick Commerce sales by Master SKU.
 * Clubs all 6 QC channels together as one combined reserve.
 * Returns Map<masterSku, salesRows[]>
 *
 * Source: Sales Data, Channel Name IN QCOMM_CHANNEL_NAMES
 */
function loadQCommSalesMap(CONFIG) {
  const data      = getSheetData(AMAZON_SHEETS.sales);
  const sheetName = AMAZON_SHEETS.sales;
  const salesMap  = new Map(); // masterSku → [{ date, qty }]

  // Parse channel names from config string
  const qcChannels = new Set(
    String(CONFIG.QCOMM_CHANNEL_NAMES || '')
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean)
  );

  const today      = new Date();
  const cutoffDate = new Date(today.getTime() - CONFIG.AMAZON_SALES_HISTORY_DAYS * 24 * 60 * 60 * 1000);

  for (const row of data) {
    if (!ArrayOfRow(row)) continue;

    const channelName = (getValue(row, sheetName, 'Channel Name') || '').toUpperCase().trim();
    if (!qcChannels.has(channelName)) continue;

    const dateVal   = getValue(row, sheetName, 'Date');
    const masterSku = getValue(row, sheetName, 'Master SKU') || '';
    const qty       = getValue(row, sheetName, 'Quantity', true);

    if (!masterSku || !dateVal || qty <= 0) continue;

    //const saleDate = new Date(dateVal);
    //if (isNaN(saleDate.getTime()) || saleDate < cutoffDate) continue;
    const saleDate = new Date(dateVal);
    saleDate.setHours(0, 0, 0, 0); // normalize to midnight
    if (isNaN(saleDate.getTime()) || saleDate < cutoffDate) continue;
    if (saleDate >= today) continue; // exclude today — data incomplete

    if (!salesMap.has(masterSku)) salesMap.set(masterSku, []);
    salesMap.get(masterSku).push({ date: saleDate, qty });
  }

  return salesMap;
}
/**
 * Loads Amazon FBA inventory by Master SKU.
 * Returns Map<masterSku, { fbaQty, reserved, inbound }>
 *
 * Source: Inventory Data, Channel Name = AMAZON
 */
function loadAmazonInventoryMap(CONFIG) {
  const data      = getSheetData(AMAZON_SHEETS.inventory);
  const sheetName = AMAZON_SHEETS.inventory;
  const invMap    = new Map();

  for (const row of data) {
    if (!ArrayOfRow(row)) continue;

    const channelName = (getValue(row, sheetName, 'Channel Name') || '').toUpperCase().trim();
    if (channelName !== CONFIG.AMAZON_CHANNEL_NAME.toUpperCase().trim()) continue;

    /*const masterSku = getValue(row, sheetName, 'Master SKU') || '';
    if (!masterSku) continue;

      const fbaQty   = getValue(row, sheetName, 'InStock (Fulfillable)', true);
      const reserved = getValue(row, sheetName, 'Reserved (Total)', true);
      const inbound  = getValue(row, sheetName, 'Inbound (Shipped)', true);
      const pending  = getValue(row, sheetName, 'Inbound (Pending)', true);  // NEW

      const existing = invMap.get(masterSku) || { fbaQty: 0, reserved: 0, inbound: 0, pending: 0 };
      invMap.set(masterSku, {
        //fbaQty:   Math.max(0, existing.fbaQty + fbaQty),  // floor at 0 for DOC calc
        fbaQty: (existing.fbaQty || 0) + fbaQty,  // raw value — negative FBA is offset in Reserved
        reserved: existing.reserved + reserved,
        inbound:  existing.inbound  + inbound,
        pending:  existing.pending  + pending,             // NEW — raw value, no floor
      });*/
      // Key by Channel SKU — gives each Channel SKU its own FBA/Inbound/Pending
      const channelSku = String(getValue(row, sheetName, 'Channel SKU') || '').trim();
      if (!channelSku) continue;

      const fbaQty   = getValue(row, sheetName, 'InStock (Fulfillable)', true);
      const reserved = getValue(row, sheetName, 'Reserved (Total)', true);
      const inbound  = getValue(row, sheetName, 'Inbound (Shipped)', true);
      const pending  = getValue(row, sheetName, 'Inbound (Pending)', true);

      const existing = invMap.get(channelSku) || { fbaQty: 0, reserved: 0, inbound: 0, pending: 0 };
      invMap.set(channelSku, {
        fbaQty:   (existing.fbaQty || 0) + fbaQty,
        reserved: existing.reserved + reserved,
        inbound:  existing.inbound  + inbound,
        pending:  existing.pending  + pending,
    });
    
  }

  return invMap;
}

/**
 * Builds in-transit warning map for Amazon-relevant SKUs.
 * Warns when a China→India shipment ETA is within AMAZON_INTRANSIT_WARNING_DAYS.
 *
 * Source: EE Purchase Orders, Status ID = 3 (in-transit), non-PENDING_PIPELINE
 * Returns Map<masterSku, { hasWarning, etaDays, qty, poId }>
 */
function buildInTransitWarningMap(CONFIG) {
  const warningMap = new Map();
  const today      = new Date();
  const dayMs      = 24 * 60 * 60 * 1000;

  try {
    const eePoData  = getSheetData(SHEETS.ee_po);
    const sheetName = SHEETS.ee_po;

    for (const row of eePoData) {
      if (!ArrayOfRow(row) || !row[0]) continue;

      const sku        = getValue(row, sheetName, 'SKU') || '';
      if (!sku) continue;

      const statusIdRaw = getValue(row, sheetName, 'PO Status ID');
      const statusId    = statusIdRaw !== null ? String(statusIdRaw).trim() : '';
      if (statusId !== '3') continue;

      const poRef = getValue(row, sheetName, 'PO Ref Num') || '';
      if (poRef === 'PENDING_PIPELINE') continue;

      const pendingQty = getValue(row, sheetName, 'Pending Quantity', true);
      if (pendingQty <= 0) continue;

      const etaStr = getValue(row, sheetName, 'ETA') || '';
      if (!etaStr) continue;

      const etaDate = new Date(etaStr);
      if (isNaN(etaDate.getTime())) continue;

      const etaDays = Math.round((etaDate.getTime() - today.getTime()) / dayMs);

      // Only warn if ETA is within warning window (and not already arrived)
      if (etaDays > 0 && etaDays <= CONFIG.AMAZON_INTRANSIT_WARNING_DAYS) {
        const existing = warningMap.get(sku);
        // Keep the soonest ETA if multiple POs
        if (!existing || etaDays < existing.etaDays) {
          warningMap.set(sku, {
            hasWarning: true,
            etaDays:    etaDays,
            qty:        ri(pendingQty),
            poId:       poRef,
          });
        }
      }
    }
  } catch (err) {
    Logger.log('buildInTransitWarningMap error: ' + err.message);
  }

  return warningMap;
}
/**
 * Loads EasyEcom warehouse inventory by Master SKU.
 * Returns Map<masterSku, warehouseQty>
 *
 * Source: Inventory Data, Channel Name = EASY ECOM
 */
function loadWarehouseInventoryMap(CONFIG) {
  const data      = getSheetData(AMAZON_SHEETS.inventory);
  const sheetName = AMAZON_SHEETS.inventory;
  const whMap     = new Map();

  for (const row of data) {
    if (!ArrayOfRow(row)) continue;

    const channelName = (getValue(row, sheetName, 'Channel Name') || '').toUpperCase().trim();
    if (channelName !== CONFIG.EASYECOM_CHANNEL_NAME.toUpperCase().trim()) continue;

    const masterSku = getValue(row, sheetName, 'Master SKU') || '';
    if (!masterSku) continue;

    const inStock = getValue(row, sheetName, 'InStock (Fulfillable)', true);
    //whMap.set(masterSku, (whMap.get(masterSku) || 0) + inStock);
    const strictPending = getValue(row, sheetName, 'Strict (Pending)', true) || 0;
    const existing = whMap.get(masterSku) || { warehouseQty: 0, strictPending: 0 };
      whMap.set(masterSku, {
        warehouseQty:   existing.warehouseQty + inStock,
        strictPending:  existing.strictPending + strictPending,
    });

  }

  return whMap;
}

/**
 * Loads product details by Master SKU.
 * Returns Map<masterSku, { productName, packSize, cost, mrp, yeioReserve }>
 *
 * Source: EE Product Master
 */
function loadProductMasterMap() {
  const data      = getSheetData(AMAZON_SHEETS.products);
  const sheetName = AMAZON_SHEETS.products;
  const prodMap   = new Map();

  for (const row of data) {
    if (!ArrayOfRow(row)) continue;
    const sku = getValue(row, sheetName, 'SKU') || '';
    if (!sku) continue;

    prodMap.set(sku, {
      productName:  getValue(row, sheetName, 'Product Name') || '',
      packSize:     getValue(row, sheetName, 'Pack Size', true) || 0,
      cost:         getValue(row, sheetName, 'Cost', true) || 0,
      mrp:          getValue(row, sheetName, 'MRP', true) || 0,
      yeioReserve:  getValue(row, sheetName, 'YEIO_Reserve', true) || 0,
    });
  }

  return prodMap;
}

/**
 * Builds a Set of combo/kit Master SKUs.
 * Source: EE Component Master, Product Type column
 */
function buildComboSkuSet() {
  const data      = getSheetData(AMAZON_SHEETS.components);
  const sheetName = AMAZON_SHEETS.components;
  const comboSet  = new Set();

  for (const row of data) {
    if (!ArrayOfRow(row)) continue;
    const parentSku   = getValue(row, sheetName, 'Parent SKU') || '';
    const productType = (getValue(row, sheetName, 'Product Type') || '').toLowerCase();
    if (parentSku && (productType === 'combo' || productType === 'kit_product')) {
      comboSet.add(parentSku);
    }
  }

  return comboSet;
}

// ===================================================================
// STEP 1 — AMAZON MMA CALCULATION (per Channel SKU)
// ===================================================================

/**
 * Calculates 90-day weighted average MMA for a Channel SKU.
 * Uses same bucket weights as existing Sea/Air forecast.
 * Applies MMA floor check.
 *
 * @param {Array} salesRows  — [{ date, qty }] for this Channel SKU
 * @param {Object} CONFIG
 * @returns {Object} { calculated, final, last7DaysSales, dailyHistory }
 */
function calculateAmazonMMA(salesRows, CONFIG) {
  //const today = new Date();
  //const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0); // normalize to midnight — exclude today's partial data
  const dayMs = 24 * 60 * 60 * 1000;

  // ── Bucket accumulators ───────────────────────────────────────
  let total15 = 0, total30 = 0, total60 = 0, total90 = 0;
  let last7DaysSales = 0;

  // ── Daily history map (for chart + stockout signal) ───────────
  const dailyMap = {};

  for (const { date, qty } of salesRows) {
    const daysAgo = (today.getTime() - date.getTime()) / dayMs;
    //const dateKey = date.toISOString().split('T')[0];

    //dailyMap[dateKey] = (dailyMap[dateKey] || 0) + qty;
    const dateKey = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    dailyMap[dateKey] = (dailyMap[dateKey] || 0) + qty;

    total90 += qty;
    if (daysAgo <= 60) total60 += qty; // 30–60 bucket uses this accumulator as 30-60
    if (daysAgo <= 30) total30 += qty;
    if (daysAgo <= 15) total15 += qty;
    if (daysAgo <=  7) last7DaysSales += qty;
  }

  // ── Bucket daily rates ────────────────────────────────────────
  const ads15 = total15 / 15;
  const ads30 = total30 / 30;
  const ads60 = (total60 - total30) / 30;  // units in days 30–60 ÷ 30
  const ads90 = (total90 - total60) / 30;  // units in days 60–90 ÷ 30

  // ── Weighted ADS ──────────────────────────────────────────────
  const weightedADS =
    ads15 * CONFIG.ADS_WEIGHT_15D +
    ads30 * CONFIG.ADS_WEIGHT_30D +
    ads60 * CONFIG.ADS_WEIGHT_60D +
    ads90 * CONFIG.ADS_WEIGHT_90D;

  const calculatedMMA = weightedADS * 30;

  // ── Floor check ───────────────────────────────────────────────
  let finalMMA = calculatedMMA;
  let floorApplied = false;
  if (calculatedMMA > 0 && calculatedMMA < CONFIG.AMAZON_MMA_FLOOR) {
    finalMMA     = CONFIG.AMAZON_MMA_MIN;
    floorApplied = true;
  }

  // ── Gap-filled daily history (for 90-day chart) ───────────────
      const dailyHistory = [];
  // for (let i = CONFIG.AMAZON_SALES_HISTORY_DAYS - 1; i >= 0; i--) {
  //   const d = new Date(today);
  //   d.setDate(d.getDate() - i);
  //   const key = d.toISOString().split('T')[0];
  //   dailyHistory.push({ date: key, units: dailyMap[key] || 0 });
  // }
     const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // Use script timezone for date keys — toISOString() uses UTC which causes off-by-one
    const tz = Session.getScriptTimeZone();

for (let i = CONFIG.AMAZON_SALES_HISTORY_DAYS - 1; i >= 0; i--) {
  const d = new Date(yesterday);
  d.setDate(d.getDate() - i);  // use d.getDate() not yesterday.getDate()
  const key = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  dailyHistory.push({ date: key, units: dailyMap[key] || 0 });
}
  return {
    calculated:    r2(calculatedMMA),
    final:         r2(finalMMA),
    floorApplied,
    last7DaysSales,
    dailyHistory,
    // Bucket detail for SKU modal debug
    _buckets: { total15, total30, total60: total60 - total30, total90: total90 - total60 },
    _ads: { ads15: r2(ads15), ads30: r2(ads30), ads60: r2(ads60), ads90: r2(ads90) },
    _weightedADS: r2(weightedADS),
  };
}

/**
 * Calculates 90-day weighted average MMA for Shopify channel per Master SKU.
 * Used to compute Shopify demand reserve.
 *
 * @param {Array} salesRows — [{ date, qty }] for this Master SKU on Shopify
 * @param {Object} CONFIG
 * @returns {number} finalMMA
 */
function calculateShopifyMMA(salesRows, CONFIG) {
  if (!salesRows || salesRows.length === 0) return 0;

  const today = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  let total15 = 0, total30 = 0, total60 = 0, total90 = 0;

  for (const { date, qty } of salesRows) {
    const daysAgo = (today.getTime() - date.getTime()) / dayMs;
    total90 += qty;
    if (daysAgo <= 60) total60 += qty;
    if (daysAgo <= 30) total30 += qty;
    if (daysAgo <= 15) total15 += qty;
  }

  const ads15 = total15 / 15;
  const ads30 = total30 / 30;
  const ads60 = (total60 - total30) / 30;
  const ads90 = (total90 - total60) / 30;

  const weightedADS =
    ads15 * CONFIG.ADS_WEIGHT_15D +
    ads30 * CONFIG.ADS_WEIGHT_30D +
    ads60 * CONFIG.ADS_WEIGHT_60D +
    ads90 * CONFIG.ADS_WEIGHT_90D;

  return r2(weightedADS * 30);
}

/**
 * Calculates combined Quick Commerce MMA for a Master SKU.
 * Uses same 90-day weighted average method as Shopify.
 *
 * @param {Array} salesRows — [{ date, qty }] combined across all QC channels
 * @param {Object} CONFIG
 * @returns {number} finalMMA
 */
function calculateQCommMMA(salesRows, CONFIG) {
  if (!salesRows || salesRows.length === 0) return 0;

  const today = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  let total15 = 0, total30 = 0, total60 = 0, total90 = 0;

  for (const { date, qty } of salesRows) {
    const daysAgo = (today.getTime() - date.getTime()) / dayMs;
    total90 += qty;
    if (daysAgo <= 60) total60 += qty;
    if (daysAgo <= 30) total30 += qty;
    if (daysAgo <= 15) total15 += qty;
  }

  const ads15 = total15 / 15;
  const ads30 = total30 / 30;
  const ads60 = (total60 - total30) / 30;
  const ads90 = (total90 - total60) / 30;

  const weightedADS =
    ads15 * CONFIG.ADS_WEIGHT_15D +
    ads30 * CONFIG.ADS_WEIGHT_30D +
    ads60 * CONFIG.ADS_WEIGHT_60D +
    ads90 * CONFIG.ADS_WEIGHT_90D;

  return r2(weightedADS * 30);
}
// ===================================================================
// STEP 2 — DAYS OF COVER
// ===================================================================

/**
 * Calculates Amazon Days of Cover for a Master SKU.
 *
 * DOC = (FBA Qty + Reserved + Inbound + Pending) ÷ MMA × 30
 * Pending is a placeholder (0) until wired from separate sheet.
 *
 * @returns {Object} { docDays, totalCoverage, fbaQty, reserved, inbound, pending }
 */
function calculateAmazonDOC(skuKey, amazonInvMap, mmaFinal) {
  //const inv = amazonInvMap.get(masterSku) || { fbaQty: 0, reserved: 0, inbound: 0 };
  //const pending = 0; // Placeholder — wire from separate sheet in Phase 2
  const inv = amazonInvMap.get(skuKey) || { fbaQty: 0, reserved: 0, inbound: 0, pending: 0 };
  const pending = Math.max(0, inv.pending || 0); // from Inventory Data 'Inbound (Pending)'


  const totalCoverage = inv.fbaQty + inv.reserved + inv.inbound + pending;
  const docDays = mmaFinal > 0 ? r2((totalCoverage / mmaFinal) * 30) : 999;

  return {
    docDays,
    totalCoverage: ri(totalCoverage),
    fbaQty:        ri(inv.fbaQty),
    reserved:      ri(inv.reserved),
    inbound:       ri(inv.inbound),
    pending:       ri(pending),
  };
}

// ===================================================================
// STEPS 3–5 — REPLENISHMENT CALCULATION + VELOCITY BANDS
// ===================================================================

/**
 * Calculates recommended replenishment quantity.
 * Implements Steps 3, 4, and 5.
 *
 * @param {number} docDays     — current DOC from Step 2
 * @param {number} mmaFinal    — final MMA from Step 1
 * @param {Object} CONFIG
 * @returns {Object} { needsReplenishment, calculatedQty, recommendedQty, velocityBand, docGap }
 */
function calculateReplenishment(docDays, mmaFinal, CONFIG) {
  // ── Step 3: Target coverage check ────────────────────────────
  if (docDays > CONFIG.AMAZON_DOC_THRESHOLD) {
    return {
      needsReplenishment: false,
      calculatedQty:   0,
      recommendedQty:  0,
      velocityBand:    getVelocityBand(mmaFinal, CONFIG),
      docGap:          0,
    };
  }

  // ── Step 4: Calculated quantity ───────────────────────────────
  const docGap        = CONFIG.AMAZON_TARGET_DOC - docDays;
  const calculatedQty = Math.max(0, (docGap * mmaFinal) / 30);

  // ── Step 5: Velocity band minimum rules ───────────────────────
  const velocityBand = getVelocityBand(mmaFinal, CONFIG);
  let recommendedQty = calculatedQty;

  if (velocityBand === 'slow') {
    recommendedQty = Math.max(mmaFinal / 2, calculatedQty);
  } else if (velocityBand === 'medium') {
    recommendedQty = Math.max(mmaFinal / 3, calculatedQty);
  }
  // fast → recommendedQty = calculatedQty as-is

  return {
    needsReplenishment: true,
    calculatedQty:   r2(calculatedQty),
    recommendedQty:  r2(recommendedQty),
    velocityBand,
    docGap:          r2(docGap),
  };
}

/**
 * Determines velocity band from MMA.
 * @returns {'slow'|'medium'|'fast'}
 */
function getVelocityBand(mmaFinal, CONFIG) {
  if (mmaFinal <= CONFIG.AMAZON_SLOW_MMA_MAX) return 'slow';
  if (mmaFinal >  CONFIG.AMAZON_FAST_MMA_MIN) return 'fast';
  return 'medium';
}

// ===================================================================
// STEP 6 — WAREHOUSE AVAILABILITY CHECK (per Master SKU)
// ===================================================================

/**
 * Calculates available warehouse quantity after protecting Shopify + YEIO.
 *
 * available = EE Warehouse Stock − Shopify Reserve − YEIO Reserve
 *
 * @returns {Object} { eeWarehouseStock, shopifyMMA, shopifyReserve, yeioReserve, availableQty }
 */
function calculateWarehouseAvailable(masterSku, warehouseInvMap, shopifySalesMap, qcommSalesMap, productMasterMap, CONFIG) {
  //const eeWarehouseStock = warehouseInvMap.get(masterSku) || 0;
  const whEntry          = warehouseInvMap.get(masterSku) || { warehouseQty: 0, strictPending: 0 };
  const eeWarehouseStock = whEntry.warehouseQty;
  const strictPending    = whEntry.strictPending || 0;

  const product          = productMasterMap.get(masterSku) || {};
  const yeioReserve      = product.yeioReserve || 0;

  // Shopify MMA for this Master SKU
  const shopifySalesRows = shopifySalesMap.get(masterSku) || [];
  const shopifyMMA       = calculateShopifyMMA(shopifySalesRows, CONFIG);
  const shopifyReserve   = r2(shopifyMMA * (CONFIG.SHOPIFY_RESERVE_DAYS / 30));

  // Quick Commerce reserve (clubbed across all 6 QC channels)
  const qcommSalesRows = qcommSalesMap ? (qcommSalesMap.get(masterSku) || []) : [];
  const qcommMMA       = calculateQCommMMA(qcommSalesRows, CONFIG);
  const qcommReserve   = r2(qcommMMA * (CONFIG.QCOMM_RESERVE_DAYS / 30));

  //const availableQty = Math.max(0, eeWarehouseStock - shopifyReserve - yeioReserve - qcommReserve);
  const availableQty = Math.max(0, eeWarehouseStock - shopifyReserve - yeioReserve - qcommReserve - strictPending);


  //const availableQty = Math.max(0, eeWarehouseStock - shopifyReserve - yeioReserve);

 return {
  eeWarehouseStock: ri(eeWarehouseStock),
  shopifyMMA:       r2(shopifyMMA),
  shopifyReserve:   ri(shopifyReserve),
  yeioReserve:      ri(yeioReserve),
  qcommMMA:         r2(qcommMMA),         // NEW
  qcommReserve:     ri(qcommReserve),     // NEW
  strictPending:    ri(strictPending),
  availableQty:     ri(availableQty),
};
}

// ===================================================================
// STEP 7 — INVENTORY SPLIT + SHIPMENT QUANTITY DECISION
// ===================================================================

/**
 * Determines split allocations across Channel SKUs for a Master SKU.
 *
 * CASE A: available_qty ≥ total recommended → each gets its full recommended qty
 * CASE B: available_qty < total recommended → proportional split by MMA share
 *
 * @param {Array}  channelSkuItems  — [{ channelSku, recommendedQty, mmaFinal }]
 * @param {number} availableQty
 * @returns {Array} [{ channelSku, autoAllocatedQty, splitRequired }]
 */
/*function splitInventoryProportionally(channelSkuItems, availableQty) {
  const totalRecommended = channelSkuItems.reduce((sum, item) => sum + item.recommendedQty, 0);
  const splitRequired    = availableQty < totalRecommended;

  if (!splitRequired) {
    // Case A — everyone gets what they need
    return channelSkuItems.map(item => ({
      channelSku:        item.channelSku,
      autoAllocatedQty:  item.recommendedQty,
      splitRequired:     false,
    }));
  }

  // Case B — proportional split by MMA
  const totalMMA = channelSkuItems.reduce((sum, item) => sum + (item.mmaFinal || 0), 0);

  return channelSkuItems.map(item => {
    const share           = totalMMA > 0 ? (item.mmaFinal / totalMMA) : (1 / channelSkuItems.length);
    const autoAllocatedQty = Math.floor(availableQty * share);
    return {
      channelSku: item.channelSku,
      autoAllocatedQty,
      splitRequired: true,
    };
  });
}*/

function splitInventoryProportionally(channelSkuItems, availableQty) {
  const totalRecommended = channelSkuItems.reduce((sum, item) => sum + item.recommendedQty, 0);
  const splitRequired    = availableQty < totalRecommended;

  if (!splitRequired) {
    // Case A — enough for everyone, each gets exactly what it needs
    return channelSkuItems.map(item => ({
      channelSku:       item.channelSku,
      //autoAllocatedQty: item.recommendedQty,
      autoAllocatedQty: Math.ceil(item.recommendedQty),
      splitRequired:    false,
    }));
  }

  // Case B — not enough for everyone
  // Proportional split by MMA share, BUT capped at recommendedQty
  // Never allocate more than a SKU actually needs — keep excess in warehouse
  const totalMMA = channelSkuItems.reduce((sum, item) => sum + (item.mmaFinal || 0), 0);

  return channelSkuItems.map(item => {
    const share    = totalMMA > 0
      ? (item.mmaFinal / totalMMA)
      : (1 / channelSkuItems.length);

    const prorated         = Math.floor(availableQty * share);
    const autoAllocatedQty = Math.min(prorated, Math.ceil(item.recommendedQty));

    Logger.log(
      'Split: ' + item.channelSku +
      ' | MMA share: ' + Math.round(share * 100) + '%' +
      ' | prorated: ' + prorated +
      ' | recommendedQty: ' + item.recommendedQty +
      ' | allocated: ' + autoAllocatedQty
    );

    return {
      channelSku:       item.channelSku,
      autoAllocatedQty: autoAllocatedQty,
      splitRequired:    true,
    };
  });
}

// ===================================================================
// STEPS 7–8 — ROUNDING RULES
// ===================================================================

/**
 * Applies rounding rules to a quantity.
 *
 * Combo SKUs: skip case pack, apply standard rounding only
 * Non-combo with pack size: round UP to nearest full case
 * Otherwise: qty < threshold → nearest 5 | qty ≥ threshold → nearest 10
 *
 * @param {number} qty
 * @param {number} packSize
 * @param {boolean} isCombo
 * @param {Object} CONFIG
 * @returns {number} rounded shipping plan qty
 */
//function applyRoundingRules(qty, packSize, isCombo, CONFIG, availableQty) {
  function applyRoundingRules(qty, packSize, isCombo, CONFIG, availableQty, recommendedQty) {
  if (qty <= 0) return 0;

  // Cap at available warehouse stock BEFORE rounding
  const cappedQty = (availableQty !== undefined && availableQty >= 0)
    ? Math.min(qty, availableQty)
    : qty;

  if (cappedQty <= 0) return 0;
  if (recommendedQty !== undefined && cappedQty < recommendedQty) return cappedQty;


  if (!isCombo && packSize > 1) {
    // Round down to nearest full case
    // If less than 1 full case available, ship remaining units as-is
    const rounded = rRound(cappedQty, packSize);
    return rounded > 0 ? rounded : cappedQty; // fallback: ship what's available
  }

  if (cappedQty < CONFIG.AMAZON_ROUND_THRESHOLD) {
    const rounded = rDown(cappedQty, 5);
    return rounded > 0 ? rounded : cappedQty; // fallback: ship what's available
  } else {
    const rounded = rDown(cappedQty, 10);
    return rounded > 0 ? rounded : cappedQty; // fallback: ship what's available
  }
}
// ===================================================================
// STOCKOUT SIGNAL
// ===================================================================

/**
 * Checks if a Channel SKU has a possible listing issue.
 * Flag: MMA > 0 but last N days sales = 0.
 */
function checkListingIssue(mmaFinal, last7DaysSales, CONFIG) {
  if (mmaFinal > 0 && last7DaysSales === 0) {
    return {
      hasListingIssue: true,
      message: `MMA = ${r2(mmaFinal)} but 0 sales in last ${CONFIG.AMAZON_STOCKOUT_SIGNAL_DAYS} days. Possible listing issue.`,
    };
  }
  return { hasListingIssue: false, message: null };
}

// ===================================================================
// MAIN ORCHESTRATOR — runAmazonForecast()
// ===================================================================

/**
 * Runs the full Amazon FBA forecasting engine.
 * Returns an array of per-Channel-SKU result objects.
 *
 * Called by apiGetAmazonForecast().
 */

function runAmazonForecast() {
  const CONFIG = getAmazonConfig();

  // ── Load all data once ────────────────────────────────────────
  const { channelToMaster, masterToChannels } = buildAmazonSkuMap(CONFIG);

  // ── Build excluded Channel SKU set from EE Product Master ─────
  // Read Exclude_List column, find Master SKUs marked 'Yes',
  // collect all their Channel SKUs directly from masterToChannels map
  const excludedChannelSkus = new Set();
  try {
    const productData  = getSheetData(AMAZON_SHEETS.products);
    const productSheet = AMAZON_SHEETS.products;

    for (const row of productData) {
      if (!ArrayOfRow(row)) continue;
      const masterSku   = String(getValue(row, productSheet, 'SKU') || '').trim();
      const excludeFlag = String(getValue(row, productSheet, 'Exclude_List') || '').trim().toUpperCase();

      if (!masterSku || excludeFlag !== 'YES') continue;

      // Find all Channel SKUs mapped to this Master SKU
      const channelEntries = masterToChannels.get(masterSku) || [];
      for (const { channelSku } of channelEntries) {
        excludedChannelSkus.add(channelSku);
        Logger.log('Marking excluded Channel SKU: ' + channelSku + ' (Master SKU: ' + masterSku + ' → Exclude_List=Yes)');
      }
    }
    Logger.log('Total excluded Channel SKUs: ' + excludedChannelSkus.size);
  } catch (err) {
    Logger.log('Exclude list build error: ' + err.message);
  }

  const amazonSalesMap   = loadAmazonSalesMap(CONFIG);
  const shopifySalesMap  = loadShopifySalesMap(CONFIG);
  const amazonInvMap     = loadAmazonInventoryMap(CONFIG);
  const warehouseInvMap  = loadWarehouseInventoryMap(CONFIG);
  const productMasterMap = loadProductMasterMap();
  const comboSkuSet      = buildComboSkuSet();

  // Load Quick Commerce sales map
  const qcommSalesMap = loadQCommSalesMap(CONFIG);

  // Build in-transit warning map
  const inTransitWarningMap = buildInTransitWarningMap(CONFIG);

  // ── Group Channel SKUs by Master SKU ─────────────────────────
  const results = [];

  for (const [masterSku, channelSkuEntries] of masterToChannels.entries()) {
    const product = productMasterMap.get(masterSku);

    // Skip SKUs with no entry in EE Product Master entirely
    if (!product) {
      Logger.log('Skipping masterSKU: ' + masterSku + ' — not found in EE Product Master');
      continue;
    }

    const isCombo  = comboSkuSet.has(masterSku);
    const packSize = product.packSize || 0;

    // ── Per-Channel-SKU: Steps 1–5 ─────────────────────────────
    const channelSkuItems = [];

    //for (const { channelSku, channelItemCode } of channelSkuEntries) {
      //for (const { channelSku, channelItemCode, alternateSku } of channelSkuEntries) {
      for (const { channelSku, channelItemCode, alternateSku, channelExclusion } of channelSkuEntries) {



      // Mark excluded Channel SKUs — frontend filter handles visibility
      //const isExcluded = excludedChannelSkus.has(channelSku);
      const isExcluded = excludedChannelSkus.has(channelSku) || channelExclusion === true;


      const salesRows = amazonSalesMap.get(channelSku) || [];

      // Step 1: MMA
      const mmaResult = calculateAmazonMMA(salesRows, CONFIG);
      const mmaFinal  = mmaResult.final;

      // Stockout signal
      const listingSignal = checkListingIssue(mmaFinal, mmaResult.last7DaysSales, CONFIG);

      // Step 2: DOC (uses Master SKU inventory)
      //const docResult = calculateAmazonDOC(masterSku, amazonInvMap, mmaFinal);
      const docResult = calculateAmazonDOC(channelSku, amazonInvMap, mmaFinal);


      // Steps 3–5: Replenishment
      const replResult = calculateReplenishment(docResult.docDays, mmaFinal, CONFIG);

      // In-transit warning for this Master SKU
      const inTransitWarn = inTransitWarningMap.get(masterSku) || {
        hasWarning: false,
        etaDays:    null,
        qty:        0,
        poId:       null,
      };

      channelSkuItems.push({
        channelSku,
        channelItemCode,
        masterSku,
        alternateSku,
        mmaResult,
        mmaFinal,
        docResult,
        replResult,
        listingSignal,
        isCombo,
        packSize,
        product,
        inTransitWarning: inTransitWarn,
        isExcluded,
      });
    }

    // Skip master SKU entirely if all its channel SKUs were excluded
    // (only when ALL are excluded — if some are not, still process)
    const nonExcludedItems = channelSkuItems.filter(i => !i.isExcluded);
    if (channelSkuItems.length === 0) continue;

    // ── Step 6: Warehouse check (per Master SKU) ────────────────
    const warehouseResult = calculateWarehouseAvailable(
      masterSku, warehouseInvMap, shopifySalesMap, qcommSalesMap, productMasterMap, CONFIG
    );

    // ── Step 7: Inventory split ──────────────────────────────────
    // Use only non-excluded items for split calculation
    const splitInputs = nonExcludedItems.map(item => ({
      channelSku:     item.channelSku,
      recommendedQty: item.replResult.recommendedQty,
      mmaFinal:       item.mmaFinal,
    }));

    const splitResults   = splitInventoryProportionally(
      splitInputs.length > 0 ? splitInputs : channelSkuItems.map(item => ({
        channelSku:     item.channelSku,
        recommendedQty: item.replResult.recommendedQty,
        mmaFinal:       item.mmaFinal,
      })),
      warehouseResult.availableQty
    );
    const splitResultMap = new Map(splitResults.map(s => [s.channelSku, s]));

    // ── Build final output per Channel SKU ───────────────────────
    for (const item of channelSkuItems) {
      const split           = splitResultMap.get(item.channelSku) || {};
      const autoQty         = item.replResult.needsReplenishment ? (split.autoAllocatedQty || 0) : 0;
      //const shippingPlanQty = applyRoundingRules(autoQty, item.packSize, item.isCombo, CONFIG, warehouseResult.availableQty);
      const shippingPlanQty = applyRoundingRules(autoQty, item.packSize, item.isCombo, CONFIG, warehouseResult.availableQty, item.replResult.recommendedQty);


      results.push({
        // ── Identifiers ──────────────────────────────────────
        channelSKU:      item.channelSku,
        channelItemCode: item.channelItemCode,
        masterSKU:       masterSku,
        alternateSKU:    item.alternateSku || '',   // ADD THIS
        //productName:     item.product.productName || '',
        productName:     (item.alternateSku ? (productMasterMap.get(item.alternateSku) || {}).productName : '') || item.product.productName || '',
        packSize:        item.packSize,
        isCombo:         item.isCombo,
        cost:            item.product.cost || 0,
        mrp:             item.product.mrp  || 0,

        // ── Step 1: MMA ──────────────────────────────────────
        mma: {
          calculated:     item.mmaResult.calculated,
          final:          item.mmaResult.final,
          floorApplied:   item.mmaResult.floorApplied,
          last7DaysSales: item.mmaResult.last7DaysSales,
          _buckets:       item.mmaResult._buckets,
          _ads:           item.mmaResult._ads,
          _weightedADS:   item.mmaResult._weightedADS,
        },

        // ── Step 2: DOC ──────────────────────────────────────
        amazonInventory: {
          fbaQty:        item.docResult.fbaQty,
          reserved:      item.docResult.reserved,
          inbound:       item.docResult.inbound,
          pending:       item.docResult.pending,
          totalCoverage: item.docResult.totalCoverage,
          docDays:       item.docResult.docDays,
        },

        // ── Steps 3–5: Replenishment ─────────────────────────
        replenishment: {
          docGap:         item.replResult.docGap,
          calculatedQty:  item.replResult.calculatedQty,
          recommendedQty: item.replResult.recommendedQty,
          velocityBand:   item.replResult.velocityBand,
        },

        // ── Step 6: Warehouse ────────────────────────────────
        warehouseCheck: {
          eeWarehouseStock:             warehouseResult.eeWarehouseStock,
          shopifyMMA:                   warehouseResult.shopifyMMA,
          shopifyReserve:               warehouseResult.shopifyReserve,
          yeioReserve:                  warehouseResult.yeioReserve,
          qcommMMA:                     warehouseResult.qcommMMA,
          qcommReserve:                 warehouseResult.qcommReserve,
          availableQty:                 warehouseResult.availableQty,
          totalDemandAcrossChannelSkus: ri(splitInputs.reduce((s, x) => s + x.recommendedQty, 0)),
          canFulfill:                   !split.splitRequired,
          splitRequired:                split.splitRequired || false,
        },

        // ── Steps 7–8: Allocation ────────────────────────────
        allocation: {
          autoAllocatedQty:  ri(autoQty),
          finalAllocatedQty: ri(autoQty),
          isManualOverride:  false,
          overrideReason:    '',
          shippingPlanQty:   ri(shippingPlanQty),
        },

        // ── Flags ────────────────────────────────────────────
        needsReplenishment: item.replResult.needsReplenishment,
        hasListingIssue:    item.listingSignal.hasListingIssue,
        listingIssueMsg:    item.listingSignal.message,
        inTransitWarning:   item.inTransitWarning,
        isExcluded:         item.isExcluded,

        // ── Chart data ───────────────────────────────────────
        salesHistory90: item.mmaResult.dailyHistory,
        salesHistory30: item.mmaResult.dailyHistory.slice(-30),
      });
    }
  }

  // ── Sort and return ───────────────────────────────────────────
  Logger.log('Amazon Forecast: ' + results.length + ' total SKUs (incl. excluded)');

  results.sort((a, b) => {
    // Excluded items always sort to bottom
    if (a.isExcluded !== b.isExcluded) return a.isExcluded ? 1 : -1;
    if (a.needsReplenishment !== b.needsReplenishment) {
      return a.needsReplenishment ? -1 : 1;
    }
    return (a.amazonInventory.docDays || 0) - (b.amazonInventory.docDays || 0);
  });

  return results;
}
// ===================================================================
// STEP 9 — WRITE TO Amazon_Shipment_Plan SHEET
// ===================================================================

/**
 * Writes confirmed shipment rows to the Amazon_Shipment_Plan sheet.
 *
 * Called when the user confirms the plan in the UI.
 * Matches exact column schema expected by downstream tool:
 *   Status | PO Date | Channel Name | PO Number | Store Code |
 *   PO EDD | PO Expiry Date | Item Code | Master SKU | Item Name |
 *   Qty | MRP | Unit Cost | Override Reason
 *
 * Override Reason is an internal column — NOT sent to downstream tool.
 *
 * @param {Array} confirmedItems — Array of { channelSKU, masterSKU, ... }
 *                                 with finalAllocatedQty + overrideReason
 */

/*
function writeAmazonShipmentPlan(confirmedItems, CONFIG) {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName   = CONFIG.AMAZON_OUTPUT_SHEET_NAME;
  const productMap  = loadProductMasterMap();



  // Get or create the output sheet
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log('Created new sheet: ' + sheetName);
  }

  // ── Write headers if sheet is empty ──────────────────────────
  const headers = [
    'Status', 'PO Date', 'Channel Name', 'PO Number', 'Store Code',
    'PO EDD', 'PO Expiry Date', 'Item Code', 'Master SKU', 'Item Name',
    'Qty', 'MRP', 'Unit Cost (Tax Exclusive)', 'Override Reason',
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    // Style header row
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1A56A0');
    headerRange.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }

  // ── Date helpers ─────────────────────────────────────────────
  const today = new Date();
  const poDate = Utilities.formatDate(today, Session.getScriptTimeZone(), 'dd/MM/yyyy');

  // PO EDD = today + 10 days (appointment + prep buffer)
  const eddDate = new Date(today);
  eddDate.setDate(eddDate.getDate() + 10);
  const poEDD = Utilities.formatDate(eddDate, Session.getScriptTimeZone(), 'dd/MM/yyyy');

  // PO Expiry = today + 30 days
  const expiryDate = new Date(today);
  expiryDate.setDate(expiryDate.getDate() + 30);
  const poExpiry = Utilities.formatDate(expiryDate, Session.getScriptTimeZone(), 'dd/MM/yyyy');

  // Generate a PO Number (AZ + YYYYMMDD + sequence)
      // const dateStr   = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
      // const poNumber  = 'AZ' + dateStr;

  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');

// Count how many AZ shipments already exist today to generate unique daily counter
let todayCount = 0;
try {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    // PO Number is column 4 (D), PO Date is column 2 (B)
    const poNumCol  = sheet.getRange(2, 4, lastRow - 1, 1).getValues().flat();
    const datePrefix = 'AZ' + dateStr;
    todayCount = poNumCol.filter(p => String(p).startsWith(datePrefix)).length;
  }
} catch (err) {
  Logger.log('PO counter read error: ' + err.message);
}

const poNumber = 'AZ' + dateStr + '-' + (todayCount + 1);

  // ── Build rows ────────────────────────────────────────────────
  const rows = [];
  for (const item of confirmedItems) {
    //const qty = item.allocation?.finalAllocatedQty || item.allocation?.shippingPlanQty || 0;
    // Priority: manual ship qty override → finalAllocatedQty → shippingPlanQty
    // Never use recommendedQty — that is the calculated suggestion, not what was confirmed
    const qty = item.allocation?.finalAllocatedQty ?? item.allocation?.shippingPlanQty ?? 0;
    if (qty <= 0) continue;

    const product = productMap.get(item.masterSKU) || {};

    rows.push([
      CONFIG.AMAZON_OUTPUT_STATUS,        // Status
      poDate,                             // PO Date
      CONFIG.AMAZON_OUTPUT_CHANNEL_NAME,  // Channel Name
      poNumber,                           // PO Number
      CONFIG.AMAZON_OUTPUT_STORE_CODE,    // Store Code
      poEDD,                              // PO EDD
      poExpiry,                           // PO Expiry Date
      item.channelSKU,                    // Item Code (Channel SKU)
      item.masterSKU,                     // Master SKU
      item.productName || product.productName || '', // Item Name
      qty,                                // Qty
      item.mrp  || product.mrp  || '',    // MRP
      item.cost || product.cost || '',    // Unit Cost (Tax Exclusive)
      item.allocation?.overrideReason || '', // Override Reason (internal only)
    ]);
  }

  if (rows.length === 0) {
    return { status: 'success', message: 'No items with qty > 0 to write.', rowsWritten: 0 };
  }

  // ── Append rows ───────────────────────────────────────────────
  for (const row of rows) {
    sheet.appendRow(row);
  }

  // ── Write to second sheet (B2B App building → PO_Database) ──────────────────
try {
  const secondSpreadsheetId = CONFIG.AMAZON_SECOND_OUTPUT_SPREADSHEET_ID;
  const secondSheetName     = CONFIG.AMAZON_SECOND_OUTPUT_SHEET_NAME;

  if (secondSpreadsheetId && secondSheetName) {
    const secondSS    = SpreadsheetApp.openById(secondSpreadsheetId);
    const secondSheet = secondSS.getSheetByName(secondSheetName);


    if (!secondSheet) {
      Logger.log('Second output sheet not found: ' + secondSheetName);
    } else {
      // Write same rows — columns match PO_Database schema exactly:
      // Status | PO Date | Channel Name | PO Number | Store Code |
      // PO EDD | PO Expiry Date | Item Code | Master SKU | Item Name |
      // Qty | MRP | Unit Cost (Tax Exclusive)
      // Note: NO Override Reason column in second sheet
      for (const row of rows) {
        secondSheet.appendRow(row.slice(0, 13)); // first 13 cols only, skip Override Reason
      }
      Logger.log('Second sheet write: ' + rows.length + ' rows to ' + secondSheetName);
    }
  }
} catch (secondErr) {
  // Log but don't fail the primary write
  Logger.log('Second sheet write error (non-fatal): ' + secondErr.message);
}

  Logger.log('Amazon Shipment Plan: wrote ' + rows.length + ' rows to ' + sheetName);

// ── Ensure Amazon Channel SKUs exist in Master_SKU_Mapping ──────────────────
try {
  const mappingSheet = ss.getSheetByName('Master_SKU_Mapping');

  if (!mappingSheet) {
    Logger.log('Master_SKU_Mapping sheet not found — skipping mapping check');
  } else {
    const lastMappingRow = mappingSheet.getLastRow();
    const existingMappings = new Set();

    if (lastMappingRow > 1) {
      const mappingData = mappingSheet
        .getRange(2, 1, lastMappingRow - 1, 2)
        .getValues();

      for (const [channel, channelItemCode] of mappingData) {
        const key = String(channel).trim() + '|' + String(channelItemCode).trim();
        existingMappings.add(key.toLowerCase());
      }
    }

    const rowsToAdd = [];
    for (const item of confirmedItems) {
      const qty = item.allocation?.finalAllocatedQty ?? item.allocation?.shippingPlanQty ?? 0;
      if (qty <= 0) continue;

      const key = ('Amazon_FBA|' + item.channelSKU).toLowerCase().trim();

      if (!existingMappings.has(key)) {
        rowsToAdd.push(['Amazon_FBA', item.channelSKU, item.masterSKU]);
        existingMappings.add(key);
        Logger.log('Adding to Master_SKU_Mapping: Amazon_FBA | ' + item.channelSKU + ' | ' + item.masterSKU);
      }
    }

    if (rowsToAdd.length > 0) {
      mappingSheet
        .getRange(mappingSheet.getLastRow() + 1, 1, rowsToAdd.length, 3)
        .setValues(rowsToAdd);
      Logger.log('Master_SKU_Mapping: added ' + rowsToAdd.length + ' new rows');
    } else {
      Logger.log('Master_SKU_Mapping: all Channel SKUs already exist');
    }
  }
} catch (mappingErr) {
  Logger.log('Master_SKU_Mapping update error (non-fatal): ' + mappingErr.message);
}
  return {
    status:      'success',
    message:     `${rows.length} rows written to ${sheetName}`,
    rowsWritten: rows.length,
    poNumber:    poNumber,
    poDate:      poDate,
  };
}
*/

function writeAmazonShipmentPlan(confirmedItems, CONFIG) {
  const ss         = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName  = CONFIG.AMAZON_OUTPUT_SHEET_NAME;
  const productMap = loadProductMasterMap();

  // Get or create the output sheet
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log('Created new sheet: ' + sheetName);
  }

  // ── Write headers if sheet is empty ──────────────────────────
  const headers = [
    'Status', 'PO Date', 'Channel Name', 'PO Number', 'Store Code',
    'PO EDD', 'PO Expiry Date', 'Item Code', 'Master SKU', 'Item Name',
    'Qty', 'MRP', 'Unit Cost (Tax Exclusive)', 'Override Reason',
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1A56A0');
    headerRange.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }

  // ── Date helpers ─────────────────────────────────────────────
  const today    = new Date();
  const poDate   = Utilities.formatDate(today, Session.getScriptTimeZone(), 'dd/MM/yyyy');

  const eddDate  = new Date(today);
  eddDate.setDate(eddDate.getDate() + 10);
  const poEDD    = Utilities.formatDate(eddDate, Session.getScriptTimeZone(), 'dd/MM/yyyy');

  const expiryDate = new Date(today);
  expiryDate.setDate(expiryDate.getDate() + 30);
  const poExpiry = Utilities.formatDate(expiryDate, Session.getScriptTimeZone(), 'dd/MM/yyyy');

  // ── Daily PO counter ─────────────────────────────────────────
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
  let todayCount = 0;
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const poNumCol   = sheet.getRange(2, 4, lastRow - 1, 1).getValues().flat();
      const datePrefix = 'AZ' + dateStr;
      todayCount = poNumCol.filter(p => String(p).startsWith(datePrefix)).length;
    }
  } catch (err) {
    Logger.log('PO counter read error: ' + err.message);
  }
  const poNumber = 'AZ' + dateStr + '-' + (todayCount + 1);

  // ── Build rows ────────────────────────────────────────────────
  const rows = [];
  for (const item of confirmedItems) {
    const qty = item.allocation?.finalAllocatedQty ?? item.allocation?.shippingPlanQty ?? 0;
    if (qty <= 0) continue;

    const product = productMap.get(item.masterSKU) || {};

    rows.push([
      CONFIG.AMAZON_OUTPUT_STATUS,
      poDate,
      CONFIG.AMAZON_OUTPUT_CHANNEL_NAME,
      poNumber,
      CONFIG.AMAZON_OUTPUT_STORE_CODE,
      poEDD,
      poExpiry,
      item.channelSKU,
      //item.masterSKU,
      (item.alternateSKU && item.alternateSKU.trim() !== '') ? item.alternateSKU : item.masterSKU,
      item.productName || product.productName || '',
      qty,
      item.mrp  || product.mrp  || '',
      item.cost || product.cost || '',
      item.allocation?.overrideReason || '',
    ]);
  }

  if (rows.length === 0) {
    return { status: 'success', message: 'No items with qty > 0 to write.', rowsWritten: 0 };
  }

  // ── Append to primary sheet ───────────────────────────────────
  for (const row of rows) {
    sheet.appendRow(row);
  }
  Logger.log('Amazon Shipment Plan: wrote ' + rows.length + ' rows to ' + sheetName);

  // ── Open second spreadsheet ONCE — reused for PO_Database and Master_SKU_Mapping ──
  let secondSS = null;
  try {
    secondSS = SpreadsheetApp.openById(CONFIG.AMAZON_SECOND_OUTPUT_SPREADSHEET_ID);
  } catch (e) {
    Logger.log('Could not open second spreadsheet: ' + e.message);
  }

  // ── Write to PO_Database ─────────────────────────────────────
  if (secondSS) {
    try {
      const secondSheet = secondSS.getSheetByName(CONFIG.AMAZON_SECOND_OUTPUT_SHEET_NAME);
      if (!secondSheet) {
        Logger.log('PO_Database sheet not found: ' + CONFIG.AMAZON_SECOND_OUTPUT_SHEET_NAME);
      } else {
        for (const row of rows) {
          secondSheet.appendRow(row.slice(0, 13)); // first 13 cols only, skip Override Reason
        }
        Logger.log('PO_Database: wrote ' + rows.length + ' rows');
      }
    } catch (secondErr) {
      Logger.log('PO_Database write error (non-fatal): ' + secondErr.message);
    }
  }

  // ── Ensure Amazon Channel SKUs exist in Master_SKU_Mapping ───
  if (secondSS) {
    try {
      const mappingSheet = secondSS.getSheetByName('Master_SKU_Mapping');

      if (!mappingSheet) {
        Logger.log('Master_SKU_Mapping sheet not found in second spreadsheet');
      } else {
        // Build lookup of existing Channel Item Codes for Amazon_FBA
        const lastMappingRow   = mappingSheet.getLastRow();
        const existingMappings = new Set();

        if (lastMappingRow > 1) {
          const mappingData = mappingSheet
            .getRange(2, 1, lastMappingRow - 1, 2)
            .getValues();

          for (const [channel, channelItemCode] of mappingData) {
            const key = String(channel).trim() + '|' + String(channelItemCode).trim();
            existingMappings.add(key.toLowerCase());
          }
        }

        // Check each confirmed item
        const rowsToAdd = [];
        for (const item of confirmedItems) {
          const qty = item.allocation?.finalAllocatedQty ?? item.allocation?.shippingPlanQty ?? 0;
          if (qty <= 0) continue;

          const key = ('Amazon_FBA|' + item.channelSKU).toLowerCase().trim();

          if (!existingMappings.has(key)) {
            rowsToAdd.push(['Amazon_FBA', item.channelSKU, item.masterSKU]);
            existingMappings.add(key); // prevent duplicates in same batch
            Logger.log('Adding to Master_SKU_Mapping: Amazon_FBA | ' + item.channelSKU + ' | ' + item.masterSKU);
          }
        }

        if (rowsToAdd.length > 0) {
          mappingSheet
            .getRange(mappingSheet.getLastRow() + 1, 1, rowsToAdd.length, 3)
            .setValues(rowsToAdd);
          Logger.log('Master_SKU_Mapping: added ' + rowsToAdd.length + ' new rows');
        } else {
          Logger.log('Master_SKU_Mapping: all Channel SKUs already exist');
        }
      }
    } catch (mappingErr) {
      Logger.log('Master_SKU_Mapping update error (non-fatal): ' + mappingErr.message);
    }
  }

  // Auto-refresh inventory after shipment plan is written
  try {
    fetch_all_inventory();
    Logger.log('fetch_all_inventory() completed after shipment plan write');
  } catch (invErr) {
    Logger.log('fetch_all_inventory() failed (non-fatal): ' + invErr.message);
}
  return {
    status:      'success',
    message:     `${rows.length} rows written to ${sheetName}`,
    rowsWritten: rows.length,
    poNumber:    poNumber,
    poDate:      poDate,
  };
}
// ===================================================================
// API ENTRY POINTS (called from doPost() in InventoryForecasting.gs)
// ===================================================================

function buildAmazonForecastConfigResponse_(CONFIG) {
  return {
    AMAZON_TARGET_DOC:             CONFIG.AMAZON_TARGET_DOC,
    AMAZON_DOC_THRESHOLD:          CONFIG.AMAZON_DOC_THRESHOLD,
    ADS_WEIGHT_15D:                CONFIG.ADS_WEIGHT_15D,
    ADS_WEIGHT_30D:                CONFIG.ADS_WEIGHT_30D,
    ADS_WEIGHT_60D:                CONFIG.ADS_WEIGHT_60D,
    ADS_WEIGHT_90D:                CONFIG.ADS_WEIGHT_90D,
    SHOPIFY_RESERVE_DAYS:          CONFIG.SHOPIFY_RESERVE_DAYS,
    QCOMM_RESERVE_DAYS:            CONFIG.QCOMM_RESERVE_DAYS,
    AMAZON_INTRANSIT_WARNING_DAYS: CONFIG.AMAZON_INTRANSIT_WARNING_DAYS,
  };
}

// ─────────────────────────────────────────────────────────────
// FORECAST CACHE — runAmazonForecast() is the most expensive computation in
// this app (5+ full sheet reads, Sales Data scanned 3x, a 90-iteration
// Utilities.formatDate loop per channel SKU — see the perf audit). Rather
// than recompute it live on every request, a time-based trigger
// (refreshAmazonForecastCache, installed once via
// setupAmazonForecastCacheTrigger below) recomputes it periodically and
// stores the result in a Drive-backed JSON file — a Sheet cell/CacheService
// key can't hold it: with salesHistory90 embedded per channel SKU for the
// modal's chart, the full payload is well beyond CacheService's 100KB-per-
// key limit. apiGetAmazonForecast then serves that cached snapshot instead
// of recomputing, unless the caller explicitly asks for a fresh one.
// ─────────────────────────────────────────────────────────────

const AMAZON_FORECAST_CACHE_PROP_KEY = 'AMAZON_FORECAST_CACHE_FILE_ID';
const AMAZON_FORECAST_CACHE_FILENAME = 'amazon_forecast_cache.json';

// Returns { generatedAt, data } from the cache file, or null if it doesn't
// exist yet or can't be read/parsed — callers fall back to a live compute.
function readAmazonForecastCache_() {
  return readDriveJsonCache_(AMAZON_FORECAST_CACHE_PROP_KEY, parsed => Array.isArray(parsed.data));
}

// Overwrites the cache file, creating it on first use (see writeDriveJsonCache_
// in entry_points.js).
function writeAmazonForecastCache_(payload) {
  writeDriveJsonCache_(AMAZON_FORECAST_CACHE_PROP_KEY, AMAZON_FORECAST_CACHE_FILENAME, payload);
}

// Runs on the time-based trigger — see setupAmazonForecastCacheTrigger.
function refreshAmazonForecastCache() {
  try {
    clearCache();
    const results = runAmazonForecast();
    clearCache();
    writeAmazonForecastCache_({ generatedAt: new Date().toISOString(), data: results });
    Logger.log('refreshAmazonForecastCache: cached ' + results.length + ' SKUs');
  } catch (err) {
    Logger.log('refreshAmazonForecastCache error: ' + err.message + '\n' + err.stack);
  }
}

// ONE-TIME SETUP — run this once manually from the Apps Script editor
// (select setupAmazonForecastCacheTrigger in the function dropdown, Run).
// Not called from doPost/doGet. Guards against creating a duplicate trigger
// if run more than once.
function setupAmazonForecastCacheTrigger() {
  const alreadyExists = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'refreshAmazonForecastCache');
  if (alreadyExists) {
    Logger.log('refreshAmazonForecastCache trigger already exists — not creating a duplicate.');
    return;
  }
  ScriptApp.newTrigger('refreshAmazonForecastCache').timeBased().everyMinutes(30).create();
  Logger.log('Created a 30-minute trigger for refreshAmazonForecastCache.');
  refreshAmazonForecastCache(); // populate the cache now instead of waiting for the first tick
}

/**
 * Returns the full Amazon forecast array to the frontend.
 * action: 'get_amazon_forecast'
 * Payload: { force?: boolean } — true bypasses the cache and recomputes
 * live (used by the manual Refresh button and the post-shipment-confirm
 * reload, which need to reflect a change that just happened).
 */
function apiGetAmazonForecast(payload) {
  try {
    const CONFIG = getAmazonConfig();
    const force  = !!(payload && payload.force);

    if (!force) {
      const cached = readAmazonForecastCache_();
      if (cached) {
        return {
          status:      'success',
          count:       cached.data.length,
          generatedAt: cached.generatedAt,
          config:      buildAmazonForecastConfigResponse_(CONFIG),
          data:        cached.data,
        };
      }
    }

    // No cache yet (first run before the trigger's first tick), or an
    // explicit refresh was requested — compute live and refresh the cache
    // so the periodic trigger and the next normal read both stay current.
    clearCache();
    const results = runAmazonForecast();
    clearCache();
    const generatedAt = new Date().toISOString();
    writeAmazonForecastCache_({ generatedAt, data: results });

    return {
      status:      'success',
      count:       results.length,
      generatedAt: generatedAt,
      config:      buildAmazonForecastConfigResponse_(CONFIG),
      data:        results,
    };
  } catch (err) {
    Logger.log('apiGetAmazonForecast error: ' + err.message + '\n' + err.stack);
    return { status: 'error', message: err.message };
  }
}


/**
 * Confirms the shipment plan and writes to Amazon_Shipment_Plan sheet.
 * action: 'confirm_amazon_shipment_plan'
 *
 * Payload: { items: [...] }  — array of confirmed Channel SKU objects
 *          with finalAllocatedQty and overrideReason populated by UI.
 */
function apiConfirmAmazonShipmentPlan(payload) {
  try {
    const CONFIG = getAmazonConfig();
    const items  = payload.items || [];

    if (items.length === 0) {
      return { status: 'error', message: 'No items provided.' };
    }

    const result = writeAmazonShipmentPlan(items, CONFIG);
    return result;
  } catch (err) {
    Logger.log('apiConfirmAmazonShipmentPlan error: ' + err.message + '\n' + err.stack);
    return { status: 'error', message: err.message };
  }
}

/**
 * Returns In Production + In Transit PO data for a single Master SKU.
 * Reuses calculatePOBalance() from InventoryForecasting.gs.
 *
 * Called via doPost() → action: 'get_amazon_sku_supply_chain'
 * Payload: { masterSKU: 'XXXXXX' }
 *
 * Returns:
 *   inProductionPOs    — POs currently in production (PENDING_PIPELINE)
 *   inTransitPOs       — POs currently in transit (Status ID = 3, non-pipeline)
 *   inProduction       — total in-production qty
 *   inTransit          — total in-transit qty
 */
function apiGetAmazonSkuSupplyChain(payload) {
  try {
    const masterSKU = payload.masterSKU || '';
    if (!masterSKU) {
      return { status: 'error', message: 'masterSKU is required.' };
    }

    // Reuse existing PO balance calculation from InventoryForecasting.gs
    // This reads EE Purchase Orders sheet — same source as IF modal
    const eePoData   = getSheetData(SHEETS.ee_po);
    const poBalanceMap = calculatePOBalance(eePoData);

    const poBalance = poBalanceMap.get(masterSKU) || {
      inProduction:       0,
      inProductionPOs:    [],
      inTransitSupplier:  0,
      inTransitSupplierPOs: [],
    };

    return {
      status:          'success',
      masterSKU:       masterSKU,
      inProduction:    poBalance.inProduction    || 0,
      inTransit:       poBalance.inTransitSupplier || 0,
      inProductionPOs: poBalance.inProductionPOs  || [],
      inTransitPOs:    poBalance.inTransitSupplierPOs || [],
    };

  } catch (err) {
    Logger.log('apiGetAmazonSkuSupplyChain error: ' + err.message + '\n' + err.stack);
    return { status: 'error', message: err.message };
  }
}

function testExcludeAndMissingMaster() {
  const result = apiGetAmazonForecast();
  
  const allItems      = result.data || [];
  const excluded      = allItems.filter(r => r.isExcluded);
  const notExcluded   = allItems.filter(r => !r.isExcluded);
  const noName        = allItems.filter(r => !r.productName || r.productName.trim() === '');

  Logger.log('=== RESULTS SUMMARY ===');
  Logger.log('Total SKUs returned:     ' + allItems.length);
  Logger.log('Normal SKUs (visible):   ' + notExcluded.length);
  Logger.log('Excluded SKUs (hidden):  ' + excluded.length);
  Logger.log('SKUs with no name:       ' + noName.length);

  Logger.log('=== FIRST 5 EXCLUDED ===');
  excluded.slice(0, 5).forEach(r => {
    Logger.log('channelSKU: ' + r.channelSKU + ' | masterSKU: ' + r.masterSKU + ' | name: ' + r.productName);
  });

  Logger.log('=== FIRST 5 NO NAME (should be 0) ===');
  noName.slice(0, 5).forEach(r => {
    Logger.log('channelSKU: ' + r.channelSKU + ' | masterSKU: ' + r.masterSKU);
  });
}
function testMasterSkuMapping() {
  const CONFIG = getAmazonConfig();

  const mockConfirmedItems = [
    {
      channelSKU: '1020098',      // replace with a real Channel SKU not in Master_SKU_Mapping
      masterSKU:  '1020098',      // replace with its Master SKU
      allocation: {
        finalAllocatedQty: 10,
        shippingPlanQty:   10,
      }
    },
    {
      channelSKU: '1030491_EAN',  // replace with another real Channel SKU
      masterSKU:  '1030491',
      allocation: {
        finalAllocatedQty: 5,
        shippingPlanQty:   5,
      }
    }
  ];

  // Open the SECOND spreadsheet — that's where Master_SKU_Mapping lives
  const secondSS = SpreadsheetApp.openById('1YM0dKPWySifYFDyNqCenJ4L85xIBSTrBGNPDcoo6Kfg');
  const mappingSheet = secondSS.getSheetByName('Master_SKU_Mapping');

  if (!mappingSheet) {
    Logger.log('ERROR: Master_SKU_Mapping sheet not found in second spreadsheet');
    return;
  }

  Logger.log('Rows before: ' + mappingSheet.getLastRow());

  // Run the full function — it will open secondSS internally
  writeAmazonShipmentPlan(mockConfirmedItems, CONFIG);

  Logger.log('Rows after: ' + mappingSheet.getLastRow());
}