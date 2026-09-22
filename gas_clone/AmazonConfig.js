/**
 * ===================================================================
 * AmazonConfig.gs
 * Amazon FBA Forecasting — Configuration
 * ===================================================================
 *
 * All Amazon forecasting thresholds live here.
 * No magic numbers anywhere in AmazonForecasting.gs.
 *
 * Config is stored in Script Properties so it can be edited
 * from the UI Config panel (Settings → Amazon) and persists
 * across executions without redeploying.
 *
 * To reset to defaults: run resetAmazonConfig() from GAS editor.
 * ===================================================================
 */

// ─── DEFAULT CONFIG ───────────────────────────────────────────────
// Fallback values used when no saved config exists.
// All values are editable via the UI Config panel.

const AMAZON_CONFIG_DEFAULTS = {

  // ── Coverage Targets ──────────────────────────────────────────
  AMAZON_TARGET_DOC:           57,   // Target days of FBA inventory coverage
  AMAZON_DOC_THRESHOLD:        50,   // If current DOC > this → send nothing
                                     // Weekly cadence: 50-57 window is intentional

  // ── MMA Settings ──────────────────────────────────────────────
  AMAZON_MMA_FLOOR:             5,   // If calculated MMA < this → apply minimum
  AMAZON_MMA_MIN:               3,   // Minimum MMA value after floor check
  AMAZON_SALES_HISTORY_DAYS:   90,   // Lookback window for MMA calculation (days)

  // ── MMA Weighted Average Bucket Weights (must sum to 1.0) ─────
  ADS_WEIGHT_15D:            0.40,   // Weight for 0–15 day bucket
  ADS_WEIGHT_30D:            0.30,   // Weight for 15–30 day bucket
  ADS_WEIGHT_60D:            0.20,   // Weight for 30–60 day bucket
  ADS_WEIGHT_90D:            0.10,   // Weight for 60–90 day bucket

  // ── Velocity Bands ────────────────────────────────────────────
  AMAZON_SLOW_MMA_MAX:         60,   // MMA ≤ this  → slow  → MAX(MMA/2, calculated_qty)
  AMAZON_FAST_MMA_MIN:        120,   // MMA > this  → fast  → calculated_qty as-is
                                     // Medium = between SLOW_MAX and FAST_MIN → MAX(MMA/3, calculated_qty)

  // ── Rounding Rules ────────────────────────────────────────────
  AMAZON_ROUND_THRESHOLD:      30,   // qty < this → round to nearest 5; else nearest 10

  // ── Reserve Settings ──────────────────────────────────────────
  SHOPIFY_RESERVE_DAYS:        30,   // Days of Shopify MMA to protect before Amazon allocation

  // ── Stockout Signal ───────────────────────────────────────────
  AMAZON_STOCKOUT_SIGNAL_DAYS:  7,   // Flag 'Possible listing issue' if sales = 0
                                     // for this many days but MMA > 0

  // ── Channel Filter Strings ────────────────────────────────────
  // Must exactly match Channel Name values in your Google Sheets.
  AMAZON_CHANNEL_NAME:    'AMAZON',
  EASYECOM_CHANNEL_NAME:  'EASY ECOM',
  SHOPIFY_CHANNEL_NAME:   'SHOPIFY',

  // ── Output Sheet ──────────────────────────────────────────────
  AMAZON_OUTPUT_SHEET_NAME: 'Amazon_Shipment_Plan',

  // ── Output Row Static Values ──────────────────────────────────
  // Written to fixed columns in the output sheet for every row.
  AMAZON_OUTPUT_STATUS:       'New',
  AMAZON_OUTPUT_CHANNEL_NAME: 'Amazon_FBA',
  AMAZON_OUTPUT_STORE_CODE:   'ISK3',         // Update to your store code if different

  // ── In-Transit Warning ────────────────────────────────────────────────────────
  AMAZON_INTRANSIT_WARNING_DAYS: 15,  // Flag if inbound ETA is within this many days

  // ── Quick Commerce Reserve ────────────────────────────────────────────────────
  QCOMM_RESERVE_DAYS: 30,             // Days of QC MMA to protect as reserve

  // ── QC Channel Names (exact match to Sales Data Channel Name column) ──────────
  // Stored as JSON string since Script Properties only supports strings
  QCOMM_CHANNEL_NAMES: 'BLINKIT,ZEPTO,BB,FLIPKARTMINUTES,INSTAMART,HAMLEYS',
  // ── Second Output Sheet (external spreadsheet) ────────────────────────────────
  AMAZON_SECOND_OUTPUT_SPREADSHEET_ID: '1YM0dKPWySifYFDyNqCenJ4L85xIBSTrBGNPDcoo6Kfg',
  AMAZON_SECOND_OUTPUT_SHEET_NAME:     'PO_Database',
  
};

// ─── SCRIPT PROPERTY KEY ─────────────────────────────────────────
const AMAZON_CONFIG_PROP_KEY = 'AMAZON_FORECASTING_CONFIG';

// ─── PUBLIC API ───────────────────────────────────────────────────

/**
 * Returns the current Amazon config.
 * Merges saved Script Properties over defaults so any missing
 * keys always fall back to defaults safely.
 *
 * This is the ONLY function AmazonForecasting.gs calls for config.
 */
function getAmazonConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty(AMAZON_CONFIG_PROP_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return Object.assign({}, AMAZON_CONFIG_DEFAULTS, parsed);
    }
  } catch (err) {
    Logger.log('getAmazonConfig: Could not load saved config, using defaults. Error: ' + err.message);
  }
  return Object.assign({}, AMAZON_CONFIG_DEFAULTS);
}

/**
 * Saves Amazon config from UI payload.
 * Called via doPost() → action: 'get_amazon_config'
 *
 * Only saves keys that exist in AMAZON_CONFIG_DEFAULTS.
 * Preserves type (number stays number, string stays string).
 */
function apiSaveAmazonConfig(payload) {
  try {
    const incoming = payload.config || payload;
    const current  = getAmazonConfig();
    const updated  = Object.assign({}, current);

    for (const key of Object.keys(AMAZON_CONFIG_DEFAULTS)) {
      if (incoming[key] !== undefined && incoming[key] !== null) {
        const defaultVal = AMAZON_CONFIG_DEFAULTS[key];
        if (typeof defaultVal === 'number') {
          const parsed = parseFloat(incoming[key]);
          if (!isNaN(parsed)) updated[key] = parsed;
        } else {
          updated[key] = String(incoming[key]).trim();
        }
      }
    }

    PropertiesService.getScriptProperties()
      .setProperty(AMAZON_CONFIG_PROP_KEY, JSON.stringify(updated));

    return { status: 'success', message: 'Amazon config saved.', config: updated };
  } catch (err) {
    Logger.log('apiSaveAmazonConfig error: ' + err.message);
    return { status: 'error', message: err.message };
  }
}

/**
 * Returns current config to the UI.
 * Called via doPost() → action: 'get_amazon_config'
 */
function apiGetAmazonConfig() {
  try {
    return { status: 'success', config: getAmazonConfig() };
  } catch (err) {
    Logger.log('apiGetAmazonConfig error: ' + err.message);
    return { status: 'error', message: err.message };
  }
}

/**
 * Resets Amazon config to defaults.
 * Run manually from GAS editor if config gets corrupted.
 */
function resetAmazonConfig() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(AMAZON_CONFIG_PROP_KEY);
    Logger.log('Amazon config reset to defaults.');
    return { status: 'success', message: 'Amazon config reset to defaults.' };
  } catch (err) {
    Logger.log('resetAmazonConfig error: ' + err.message);
    return { status: 'error', message: err.message };
  }
}