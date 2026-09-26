// =================================================================================
// ENTRY POINTS
// All Google Apps Script lifecycle & web-app entry functions live here.
// Other files must NOT define onOpen / doGet / doPost.
// =================================================================================


// ─── onOpen ───────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Automation Suite')
    .addItem('1. Run Full Daily Update (All Channels)', 'runAllUpdates')
    .addSeparator()
    .addItem('2. Update inventory (All Channels)', 'fetch_all_inventory')
    .addSeparator()
    .addItem('3. Update Amazon SKU Mapping Only', 'updateAmazonSkuMapping')
    .addToUi();
}


// ─── doGet ────────────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const request = e.parameter.request;
    const action  = e.parameter.action;
    const mode    = e.parameter.mode || 'sea';
    let result    = {};

    // ── Finance GET routes (use ?action=...) ─────────────────────────────────
    if (!request && action) {
      switch (action) {
        case 'ping':
          return successResponse_({ message: 'pong', timestamp: new Date().toISOString() });
        case 'get_vendor_accounts':
          return successResponse_({ records: getSheetData_('VendorAccounts') });
        case 'get_vendor_master':
          return successResponse_({ records: getSheetData_('Vendor Masters') });
        case 'get_purchase_invoices':
          return successResponse_({ records: getSheetData_('PurchaseInvoices') });
        case 'get_vendor_ledger_filtered':
          return vpGetLedger_(e.parameter);
        case 'get_vendor_config':
          return vpGetVendorConfig_(e.parameter.vendorCode);
        case 'get_vendor_config_list':
          return vpGetVendorConfigList_();
        case 'get_vendor_access_list':
          return vpGetVendorAccessList_();
        case 'get_vendor_by_token':
          return vpGetVendorByToken_(e.parameter.token);
        default:
          return errorResponse_('Action not supported via GET: ' + action);
      }
    }

    // ── No request param → backward-compat: return PO data ───────────────────
    if (!request) {
      result = getPurchaseOrdersData();
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Inventory Forecasting GET routes (use ?request=...) ──────────────────
    switch (request) {
      case 'forecast':
        result = e.parameter.debug == '1'
          ? runForecastDebug(mode, e)
          : runFullForecast(mode, e);
        break;
      case 'trace':
        result = runSkuTrace(mode, e);
        break;
      case 'analytics':
        result = runAnalyticsReport();
        break;
      case 'purchase_orders':
        result = getPurchaseOrdersData();
        break;
      default:
        throw new Error(
          "Invalid 'request' parameter. Must be 'forecast', 'trace', 'analytics', or 'purchase_orders'."
        );
    }

    clearCache();

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doGet: ' + error.message + ' (Stack: ' + error.stack + ')');
    return ContentService
      .createTextOutput(JSON.stringify({
        error: 'Error in doGet: ' + error.message + ' (Stack: ' + error.stack + ')'
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ─── doPost ───────────────────────────────────────────────────────────────────
// Thin wrapper: after any request that isn't a pure read, flush its sheet
// writes and bump the batch-data version so the get_batches snapshot can't
// outlive the change (see getBatchDataVersion_). The flush matters — Apps
// Script can hold writes until the execution ends, and bumping first would let
// a concurrent get_batches snapshot pre-write data under the NEW version.
function doPost(e) {
  var action = null;
  try { action = JSON.parse((e && e.postData && e.postData.contents) || '{}').action; } catch (err) {}
  try {
    return doPostInner_(e);
  } finally {
    if (!isReadAction_(action)) {
      try { SpreadsheetApp.flush(); } catch (err) {}
      bumpBatchDataVersion_();
    }
  }
}

function doPostInner_(e) {
  // Master Barcode Suite storage actions (see BarcodeAppStore.js) — returns null for anything else.
  var barcodeStoreResponse = barcodeStoreHandle_(e);
  if (barcodeStoreResponse) return barcodeStoreResponse;

  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const action = payload.action;

    // Normalize draftId across all possible payload shapes
    const normalizedDraftId =
      payload.draftId ||
      payload.id ||
      (payload.draft && payload.draft.id);
    if (normalizedDraftId) payload.draftId = normalizedDraftId;

    let result;
    switch (payload.action) {

      case 'run_inventory_forecast':
      case 'forecast':
        result = apiRunInventoryForecast(payload);
        break;

      case 'create_draft_from_forecast': {
        const effectivePayload = payload.payload ?? payload;
        result = apiCreateDraftFromForecast(effectivePayload);
        break;
      }

      case 'get_draft_orders':
      case 'get_drafts':
        result = apiGetDraftOrders();
        break;

      case 'get_draft_by_id':
      case 'get_draft_details':
        result = apiGetDraftById(payload.draftId);
        break;

      case 'get_vendor_masters':
        result = apiGetVendorMasters();
        break;

      case 'cancel_draft':
        result = apiCancelDraft(payload.id);
        break;

      case 'bulk_cancel_drafts':
        result = apiBulkCancelDrafts(payload.ids);
        break;

      case 'duplicate_draft':
        result = apiDuplicateDraft(payload.id);
        break;

      case 'search_sku_catalog':
        result = apiSearchSkuCatalog(payload.query);
        break;

      case 'add_sku_to_draft':
        result = apiAddSkuToDraft(payload.draftId, payload.sku, payload.qty);
        break;

      case 'save_draft':
        result = apiSaveDraft(payload);
        break;

      case 'submit_draft':
        result = apiSubmitDraft_(payload);
        break;

      case 'save_customization':
        return apiSaveCustomization(payload.payload || payload);

      case 'get_pos':
        result = apiGetPurchaseOrders_(payload);
        break;

      case 'get_purchase_order_details':
        result = apiGetPurchaseOrderDetails_(payload);
        break;

      case 'upload_shipment_docs':
        result = apiUploadAndNormalizeVendorShipment(payload);
        break;

      case 'get_product_master':
        result = apiGetProductMasterList();
        break;

      case 'sync_ee_product_master':
        result = apiSyncEeProductMaster_();
        break;

      case 'get_inventory_valuation':
        return apiGetInventoryValuation_(payload);

      case 'allocate_to_open_pos':
        result = apiAllocateToOpenPOs(payload);
        break;

      case 'get_review_data':
        result = apiGetReviewData(payload);
        break;

      case 'create_manual_draft':
        result = apiCreateManualDraft(payload);
        break;

      case 'create_po_direct':
        result = apiCreatePOsForUnallocatedItems_(payload);
        break;

      case 'update_shipment_drive_docs':
        result = apiUpdateShipmentDriveDocs(payload);
        break;

      case 'get_open_batches':
        result = apiGetOpenBatches(payload);
        break;

      case 'create_vendor_shipment':
        result = apiCreateVendorShipment(payload);
        break;

      case 'get_batches':
        // Logistics-only — no user_email/role gating needed (see getBatches'
        // own comment in "PO+Shipment Codes.js").
        result = getBatches();
        break;

      case 'get_batch_details':
        result = getBatchDetails(payload.batch_id, payload.user_email);
        break;

      case 'update_shipment_line_flag':
        // payload.user_email is trustworthy only because the proxy (see
        // server/app.ts) overwrites whatever the client sent with the
        // session-verified email before this request ever arrives here.
        result = apiUpdateShipmentLineFlag_(payload);
        break;

      case 'retry_easyecom_push':
        result = apiRetryEasyEcomPush(payload);
        break;

      case 'get_cnf_eligible_batches':
        result = getCnfEligibleBatches();
        break;

      case 'backfill_batch_settlement_aggregates':
        result = backfillBatchSettlementAggregates_();
        break;

      case 'backfill_batch_weight_aggregates':
        result = backfillBatchWeightAggregates_();
        break;

      case 'get_sku_categories':
        return apiGetSkuCategories();

      case 'search_sku_shipments':
        result = searchSkuShipments_(payload);
        break;

      // get_batches_finance / get_batch_finance_detail retired — merged into
      // get_batches / get_batch_details above (finance fields now attach
      // conditionally per-request based on the caller's role).
      case 'update_batch_tracking':     return updateBatchTracking(payload);
      case 'get_fx_rates':              return getFXRates();
      case 'log_payment':               return logPayment(payload);
      case 'get_payments':              return getPayments(payload);
      case 'get_vendor_accounts':       return getVendorAccounts();
      case 'get_agent_invoices':        return getAgentInvoices();
      case 'log_agent_invoice':         return logAgentInvoice(payload);
      case 'map_invoice_shipments':     return mapInvoiceToShipments(payload);
      case 'get_shipment_costing':      result = getShipmentCosting(payload);   break;
      case 'update_shipment_costing':   result = updateShipmentCosting(payload); break;
      case 'sync_shipment_costing':     result = syncShipmentCostingApi();       break;
      case 'update_shipment_finance':   result = updateShipmentFinance(payload); break;
      case 'close_po':                  result = apiClosePo_(payload);            break;
      case 'get_pending_lines':         result = apiGetPendingLines_(payload);    break;
      case 'get_sku_history':           result = apiGetSKUHistory_(payload);      break;

      case 'get_forecasting_config':
        return apiGetForecastingConfig();

      case 'save_forecasting_config':
        return apiSaveForecastingConfig(payload);

      case 'get_amazon_forecast':
        result = apiGetAmazonForecast(payload);
        break;

      case 'confirm_amazon_shipment_plan':
        result = apiConfirmAmazonShipmentPlan(payload);
        break;

      case 'get_amazon_config':
        result = apiGetAmazonConfig();
        break;

      case 'save_amazon_config':
        result = apiSaveAmazonConfig(payload);
        break;

      case 'reset_amazon_config':
        result = resetAmazonConfig();
        break;

      case 'verify_user':
        return apiVerifyUser(payload);

      case 'get_amazon_sku_supply_chain':
        result = apiGetAmazonSkuSupplyChain(payload);
        break;

      case 'getNewSkuRequests':         result = apiGetNewSkuRequests(payload);      break;
      case 'getNewSkuRequestById':      result = apiGetNewSkuRequestById(payload);   break;
      case 'saveNewSkuDraft':           result = apiSaveNewSkuDraft(payload);        break;
      case 'getNextAvailableSku':       result = apiGetNextAvailableSku(payload);    break;
      case 'getPricingConfig':          result = apiGetPricingConfig(payload);       break;
      case 'save_pricing_config':       result = apiSavePricingConfig(payload);      break;
      case 'getTagsByCategory':         result = apiGetTagsByCategory(payload);      break;
      case 'createSkuOnEasyEcom':       result = apiCreateSkuOnEasyEcom(payload);    break;
      case 'attachExistingEasyEcomSku': result = apiAttachExistingEasyEcomSku(payload); break;
      case 'createSkuOnZoho':           result = apiCreateSkuOnZoho(payload);        break;
      case 'attachExistingZohoItem':    result = apiAttachExistingZohoItem(payload); break;
      case 'createSkuOnShopify':        result = apiCreateSkuOnShopify(payload);     break;
      case 'updateEePurchaseOrder':     result = apiUpdateEePurchaseOrder(payload);  break;
      case 'rejectSkuRequest':          result = apiRejectSkuRequest(payload);       break;
      case 'markSkuComplete':           result = apiMarkSkuComplete(payload);        break;
      case 'createManualSkuRequest':    result = apiCreateManualSkuRequest(payload); break;
      case 'getParentSkuDetails':       result = apiGetParentSkuDetails(payload);    break;
      case 'getBrands':                 result = apiGetBrands(payload);              break;
      case 'addBrand':                  result = apiAddBrand(payload);               break;
      case 'getVariants':               result = apiGetVariants(payload);            break;
      case 'searchSkuForUpdate':        result = apiSearchSkuForUpdate(payload);     break;
      case 'getProductIdentifiers':     result = apiGetProductIdentifiers(payload);  break;
      case 'provisionSkuForUpdate':     result = apiProvisionSkuForUpdate(payload);  break;
      case 'updateSkuFields':           result = apiUpdateSkuFields(payload);        break;
      case 'getAuditLog':               result = apiGetAuditLog(payload);            break;
      case 'getPendingSkuUpdateRequests': result = apiGetPendingSkuUpdateRequests(payload); break;
      case 'resolveSkuUpdateRequest':   result = apiResolveSkuUpdateRequest(payload); break;

      // ── Finance ────────────────────────────────────────────────────────────
      case 'ping':
        return successResponse_({ pong: true, ts: new Date().toISOString() });

      case 'get_finance_bundle':
        return successResponse_({
          purchaseInvoices: getSheetData_('PurchaseInvoices'),
          paymentLogs:      getLinkedPaymentLogs_(),
          settlementLedger: getSheetData_('SettlementLedger'),
          vendorLedger:     getSheetData_('VendorLedger'),
          vendorShipments:  getSheetData_('Vendor_Shipments'),
        });

      case 'get_purchase_invoices':
        return successResponse_({ records: getSheetData_('PurchaseInvoices') });

      case 'get_payment_logs':
        return successResponse_({ records: getLinkedPaymentLogs_() });

      case 'get_settlement_ledger':
      case 'get_settlement_records':
        return successResponse_({ records: getSheetData_('SettlementLedger') });

      case 'get_vendor_ledger':
        return successResponse_({ records: getSheetData_('VendorLedger') });

      case 'get_vendor_shipments':
        return successResponse_({ records: getSheetData_('Vendor_Shipments') });

      case 'add_invoice':
      case 'add_purchase_invoice':
      case 'insert_purchase_invoice': {
        const r = addPurchaseInvoice(payload);
        invalidateSheetCache_('PurchaseInvoices');
        return r;
      }

      case 'insert_vendor_account':
      case 'add_vendor_account':
        return addVendorAccount(payload);

      case 'add_payment':
      case 'add_payment_log':
      case 'insert_payment_log': {
        const r = addPaymentLog(payload);
        invalidateSheetCache_('PaymentLogs');
        return r;
      }

      case 'add_adjustment_entry': {
        const r = addAdjustmentEntry(payload);
        invalidateSheetCache_('SettlementLedger');
        invalidateSheetCache_('PaymentLogs');
        return r;
      }

      case 'get_conversion_charge':
        return successResponse_({ chargePercent: getConversionChargePercent_() });

      case 'save_conversion_charge': {
        const pctInput = payload.chargePercent !== undefined ? payload.chargePercent : (payload.record && payload.record.chargePercent);
        try {
          const saved = setConversionChargePercent_(pctInput);
          return successResponse_({ chargePercent: saved });
        } catch (e) {
          return errorResponse_(e.message || String(e));
        }
      }

            case 'get_igst_rate':
        return successResponse_({ igstPercent: getIgstPercent_() });

      case 'save_igst_rate': {
        const igstInput = payload.igstPercent !== undefined ? payload.igstPercent : (payload.record && payload.record.igstPercent);
        try {
          const saved = setIgstPercent_(igstInput);
          return successResponse_({ igstPercent: saved });
        } catch (e) {
          return errorResponse_(e.message || String(e));
        }
      }

      case 'get_cnf_commission_rates': {
        try {
          return successResponse_({ rates: getCnfCommissionRates_() });
        } catch (e) {
          return errorResponse_(e.message || String(e));
        }
      }

      case 'save_cnf_commission_rates': {
        try {
          const saved = setCnfCommissionRates_(payload.rates);
          return successResponse_({ rates: saved });
        } catch (e) {
          return errorResponse_(e.message || String(e));
        }
      }

      case 'get_cnf_air_rate_categories': {
        try {
          return successResponse_({ categories: getCnfAirRateCategories_() });
        } catch (e) {
          return errorResponse_(e.message || String(e));
        }
      }

      case 'save_cnf_air_rate_categories': {
        try {
          const saved = setCnfAirRateCategories_(payload.categories);
          return successResponse_({ categories: saved });
        } catch (e) {
          return errorResponse_(e.message || String(e));
        }
      }

      case 'get_shipment_partner_defaults': {
        try {
          return successResponse_({ defaults: getShipmentPartnerDefaults_() });
        } catch (e) {
          return errorResponse_(e.message || String(e));
        }
      }

      case 'save_shipment_partner_defaults': {
        try {
          const saved = setShipmentPartnerDefaults_(payload.defaults);
          return successResponse_({ defaults: saved });
        } catch (e) {
          return errorResponse_(e.message || String(e));
        }
      }

      case 'get_shipment_partners':
        result = apiGetShipmentPartners_(payload);
        break;

      case 'get_cnf_ledger':
        result = getCnfLedgerEntries_();
        break;

      case 'add_cnf_ledger_entry':
        result = addCnfLedgerEntry_(payload);
        break;

      case 'get_cnf_shipment_bill_status':
        return successResponse_({ rows: getCnfShipmentBillStatusRows_() });

      // DO NOT invoke from the frontend — one-time migration, run manually
      // and only with explicit confirmation (writes real billing-status
      // data). See backfillCnfShipmentBillStatus_ in accounting_logger.js.
      case 'backfill_cnf_shipment_bill_status':
        result = backfillCnfShipmentBillStatus_();
        break;

      case 'request_cnf_bill':
        result = requestCnfBill_(payload);
        break;

      case 'get_cnf_invoice_batches':
        result = getCnfInvoiceBatches_();
        break;

      case 'create_cnf_invoice_batch':
        result = createCnfInvoiceBatch_(payload);
        break;

      case 'approve_cnf_invoice_batch':
        result = approveCnfInvoiceBatch(payload);
        break;

      case 'reject_cnf_invoice_batch':
        result = rejectCnfInvoiceBatch(payload);
        break;

      case 'get_bundle':
        return getBundle_(payload);

      case 'get_cnf_advances':
        return successResponse_({ advances: getCnfAdvances_() });

      case 'get_cnf_goods_invoices':
        return successResponse_({ invoices: getCnfGoodsInvoices_() });

      case 'log_cnf_goods_invoice':
        result = logCnfGoodsInvoice_(payload);
        break;

      case 'approve_cnf_goods_invoice':
        result = approveCnfGoodsInvoice_(payload);
        break;

      case 'reject_cnf_goods_invoice':
        result = rejectCnfGoodsInvoice_(payload);
        break;


      case 'get_historical_fx_rates':
        return getHistoricalFxRates_(payload);

      case 'log_settlement_record':
      case 'add_settlement':
        if (payload.record) {
          const _sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SettlementLedger');
          const _r = payload.record;
          _sheet.appendRow([
            _r.Date || _r.date || new Date().toISOString().split('T')[0],
            'SET-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            _r['Payment ID'] || _r.paymentId || '',
            _r['Vendor ID']  || _r.vendorCode || '',
            _r['Invoice ID'] || _r.invoiceId  || '',
            _r.RMB || _r.rmb || 0,
            _r.ER1 || _r.er1 || 0,
            _r.ER2 || _r.er2 || 0,
            _r['Forex Gain / Loss'] || _r.forexGainLoss || 0,
            _r.Notes || _r.remarks || _r.notes || 'Manual Entry'
          ]);
          invalidateSheetCache_('SettlementLedger');
          return successResponse_({ message: 'Settlement logged' });
        }
        return errorResponse_('No record provided for settlement');

      case 'update_purchase_invoice': {
        const r = updatePurchaseInvoice_(payload);
        invalidateSheetCache_('PurchaseInvoices');
        return r;
      }

      case 'update_payment_log': {
        const r = updatePaymentLog_(payload);
        invalidateSheetCache_('PaymentLogs');
        return r;
      }

      case 'commit_eod_engine': {
        const r = commitEodEngine_(payload);
        ['PurchaseInvoices','PaymentLogs','SettlementLedger','VendorLedger'].forEach(invalidateSheetCache_);
        return r;
      }

      case 'sync_shipments': {
        // Every user's first Finance visit fires this. It appends
        // PurchaseInvoices rows and auto-settles them, but used to take no
        // lock — two users opening Finance together could both see an
        // invoice as missing and both append it. Locked here, at the route,
        // because Apps Script locks aren't safe to take twice in one
        // execution. If a write already holds the lock, skip rather than
        // wait: the sync is opportunistic and the next Finance load retries.
        const syncLock = LockService.getScriptLock();
        if (!syncLock.tryLock(5000)) {
          return successResponse_({ message: 'Sync skipped — another write is in progress', skipped: true });
        }
        try {
          syncShipmentsToInvoices_();
        } finally {
          syncLock.releaseLock();
        }
        return successResponse_({ message: 'Synchronization triggered successfully' });
      }

      case 'delete_row':
        return deleteRowByUniqueId_(payload.table, payload.idColumn, payload.targetId);

      // ── Shipment Barcode Sync ──────────────────────────────────────────────
      case 'sync_shipment_data':
        result = apiGetShipmentSyncData(payload);
        break;

      case 'update_scanned_quantities':
        result = apiUpdateScannedQuantities(payload);
        break;

      case 'submit_vendor_entries':
        return vpSubmitEntries_(payload);

      case 'save_vendor_access':
        return vpSaveVendorAccess_(payload);

      case 'regenerate_vendor_token':
        return vpRegenerateToken_(payload);

      default:
        throw new Error('Invalid \'action\' parameter: ' + action);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doPost: ' + error.message + ' (Stack: ' + error.stack + ')');
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'error',
        message: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ─── get_bundle ───────────────────────────────────────────────────────────────
// Runs several read actions in ONE execution and returns all their results.
// Opening a screen used to fire ~13 separate requests at once (startup data +
// the screen's own datasets); run concurrently they slowed each other down —
// measured 36-38s each on 2026-09-26, versus ~5s for the same request alone —
// and the long-running ones hit Google's intermittent redirect failures.
// The frontend (services/gasApi.ts) now groups reads issued in the same
// instant into one get_bundle call.
//
// Each sub-request goes through doPost itself, so it gets exactly the same
// handler and response shape as if it had been sent on its own. Only the
// read-only actions below are accepted — a bundle can never carry a write.
var BUNDLE_READ_ACTIONS_ = {
  get_drafts: true, get_pos: true, get_vendor_masters: true,
  get_purchase_invoices: true, get_payment_logs: true, get_settlement_records: true,
  get_vendor_ledger: true, get_vendor_shipments: true,
  get_cnf_eligible_batches: true, get_cnf_advances: true, get_cnf_goods_invoices: true,
  get_cnf_ledger: true, get_cnf_invoice_batches: true, get_cnf_shipment_bill_status: true,
  get_batches: true, get_product_master: true
};

function getBundle_(payload) {
  var requests = (payload && payload.requests) || [];
  if (!Array.isArray(requests) || requests.length === 0) return errorResponse_('get_bundle: requests must be a non-empty array');
  if (requests.length > 30) return errorResponse_('get_bundle: at most 30 requests per bundle');

  var results = requests.map(function(req) {
    var action = req && req.action;
    if (!BUNDLE_READ_ACTIONS_[action]) {
      return { status: 'error', message: 'get_bundle: action not allowed in a bundle: ' + action };
    }
    try {
      var out = doPost({ postData: { contents: JSON.stringify(req) } });
      return JSON.parse(out.getContent());
    } catch (err) {
      return { status: 'error', message: 'get_bundle: ' + action + ' failed: ' + (err && err.message) };
    }
  });
  return successResponse_({ results: results });
}


// =================================================================================
// HELPERS — shared response envelope for the whole project (doGet/doPost and
// every other file). This used to be defined 3x (here, Finance.js,
// accounting_logger.js) with two incompatible shapes; Apps Script silently
// picks whichever file's declaration loads last when a name collides, so only
// one was ever actually live. This is now the sole definition — do not
// redeclare successResponse_/errorResponse_ anywhere else in the project.
// =================================================================================

/**
 * Returns a JSON success response via ContentService.
 * All fields in `data` are merged at the top level.
 */
function successResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ status: 'success' }, data)))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Returns a JSON error response via ContentService.
 */
function errorResponse_(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Sheets that are written to somewhere in the project WITHOUT a matching
 * invalidateSheetCache_() call at every write site. Caching these would risk
 * serving stale ledger/master data for up to 5 minutes after a write.
 * getSheetData_ always reads these fresh. Move a sheet out of this list only
 * after auditing every write path to it and adding invalidation.
 */
var UNCACHED_SHEETS_ = {
  'Batches': true, 'FXRates': true, 'Vendor_Shipments': true, 'VendorAccounts': true,
  'AgentInvoices': true, 'InvoiceShipmentMap': true, 'ShipmentCosting': true,
  'Vendor Masters': true, 'VendorLedger': true,
  // These two were effectively uncached already — always far over the old
  // single-key 95KB limit — and they're written from many places (SKU
  // creation, EasyEcom sync, inventory commit...) not all of which invalidate.
  // Listed explicitly now that chunking (below) would otherwise start caching
  // them, so removing the size cap changes nothing for them.
  'EE Product Master': true, 'Inventory Data': true
};

// ─── Chunked CacheService storage ─────────────────────────────────────────────
// CacheService caps each value at 100KB, so anything bigger used to be simply
// not cached (getSheetData_ skipped any sheet over 95KB — a silent cliff the
// finance sheets would hit as they grow). This splits a string across several
// keys. Chunks are 30,000 characters so even 3-byte UTF-8 text (Chinese vendor
// names) stays under the per-value byte limit. Each write gets a fresh id and
// the meta key is written LAST, so a reader can never stitch together chunks
// from two different writes — it either sees a complete set or a miss.
var CHUNK_CHARS_ = 30000;
var MAX_CHUNKS_ = 60; // ~1.8M chars — anything larger just isn't cached

function putChunkedCache_(key, str, ttlSeconds, extraMeta) {
  try {
    var n = Math.ceil(str.length / CHUNK_CHARS_);
    if (n === 0 || n > MAX_CHUNKS_) return false;
    var id = Utilities.getUuid().slice(0, 8);
    var items = {};
    for (var i = 0; i < n; i++) items[key + '__' + id + '__' + i] = str.substr(i * CHUNK_CHARS_, CHUNK_CHARS_);
    var cache = CacheService.getScriptCache();
    cache.putAll(items, ttlSeconds);
    var meta = { id: id, n: n };
    if (extraMeta) Object.keys(extraMeta).forEach(function(k) { meta[k] = extraMeta[k]; });
    cache.put(key + '__meta', JSON.stringify(meta), ttlSeconds);
    return true;
  } catch (e) {
    return false;
  }
}

// Returns { value, meta } or null on any miss (meta missing, a chunk evicted).
function getChunkedCache_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var metaRaw = cache.get(key + '__meta');
    if (!metaRaw) return null;
    var meta = JSON.parse(metaRaw);
    var keys = [];
    for (var i = 0; i < meta.n; i++) keys.push(key + '__' + meta.id + '__' + i);
    var got = cache.getAll(keys);
    var parts = [];
    for (var j = 0; j < keys.length; j++) {
      if (got[keys[j]] == null) return null;
      parts.push(got[keys[j]]);
    }
    return { value: parts.join(''), meta: meta };
  } catch (e) {
    return null;
  }
}

function removeChunkedCache_(key) {
  try { CacheService.getScriptCache().remove(key + '__meta'); } catch (e) {}
}

// ─── Batch data version ───────────────────────────────────────────────────────
// Stamp for the get_batches snapshot (see getBatches in PO+Shipment Codes.js).
// doPost bumps it after every request that isn't a pure read, so a snapshot
// built before a write is never served after it. A missing stamp (evicted) is
// replaced with a fresh one, which likewise invalidates any old snapshot.
var BATCH_DATA_VERSION_KEY_ = 'batch_data_version';

function getBatchDataVersion_() {
  var cache = CacheService.getScriptCache();
  var v = cache.get(BATCH_DATA_VERSION_KEY_);
  if (!v) {
    v = Utilities.getUuid();
    cache.put(BATCH_DATA_VERSION_KEY_, v, 21600);
  }
  return v;
}

function bumpBatchDataVersion_() {
  try { CacheService.getScriptCache().put(BATCH_DATA_VERSION_KEY_, Utilities.getUuid(), 21600); } catch (e) {}
}

// Same classification as the frontend's (services/gasApi.ts isReadAction_).
// Anything not matching is treated as a write — erring that way only costs a
// snapshot rebuild.
function isReadAction_(action) {
  return /^(get|search|verify|ping|fetch)/i.test(String(action || ''));
}

/**
 * Reads all rows from a named sheet as plain objects keyed by header name.
 * For sheets with full invalidateSheetCache_() coverage on every write path,
 * results are cached in CacheService for 5 minutes to avoid repeated sheet
 * I/O — call invalidateSheetCache_(sheetName) after any write to that sheet.
 * Sheets listed in UNCACHED_SHEETS_ always read live (see comment above).
 */
function getSheetData_(sheetName) {
  const cacheable = !UNCACHED_SHEETS_[sheetName];
  const key = 'gsd_' + sheetName;
  if (cacheable) {
    const hit = getChunkedCache_(key);
    if (hit) {
      try { return JSON.parse(hit.value); } catch(e) {}
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(h => String(h).trim());
  const result = values.slice(1)
    .filter(row => row.some(cell => cell !== "" && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

  if (cacheable) {
    try {
      putChunkedCache_(key, JSON.stringify(result), 300); // 5-min TTL, any size up to MAX_CHUNKS_
    } catch(e) {}
  }

  return result;
}

/** Busts the CacheService entry for a sheet after a write. */
function invalidateSheetCache_(sheetName) {
  removeChunkedCache_('gsd_' + sheetName);
  // Pre-chunking single-key entry — may still be in the cache for up to its
  // 5-min TTL right after this deploy; nothing reads it any more, but clear
  // it too so there's no doubt.
  try { CacheService.getScriptCache().remove('gsd_' + sheetName); } catch(e) {}
}

/**
 * Drive-backed JSON snapshot store, for precomputed results that are too big
 * for CacheService (100KB per key) or a sheet cell. The file id is remembered
 * in Script Properties under `propKey` so every write overwrites the same
 * file instead of accumulating new ones. Used by the Amazon forecast cache and
 * the Inventory valuation snapshot.
 *
 * readDriveJsonCache_ returns the parsed object, or null if there is no file
 * yet, it can't be read/parsed, or `isValid(parsed)` says it isn't the shape
 * the caller expects — callers fall back to computing live.
 */
function readDriveJsonCache_(propKey, isValid) {
  try {
    const fileId = PropertiesService.getScriptProperties().getProperty(propKey);
    if (!fileId) return null;
    const parsed = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
    if (!parsed || (isValid && !isValid(parsed))) return null;
    return parsed;
  } catch (err) {
    Logger.log('readDriveJsonCache_(' + propKey + ') error: ' + err.message);
    return null;
  }
}

function writeDriveJsonCache_(propKey, fileName, payload) {
  const json = JSON.stringify(payload);
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty(propKey);
  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setContent(json);
      return;
    } catch (err) {
      Logger.log('writeDriveJsonCache_(' + propKey + '): stored file id invalid, creating a new one: ' + err.message);
    }
  }
  const newFile = DriveApp.createFile(fileName, json, MimeType.PLAIN_TEXT);
  props.setProperty(propKey, newFile.getId());
}

/**
 * Live role lookup against the Users sheet (same source apiVerifyUser reads
 * at login) — returns 'ADMIN', another role string, or null if the email
 * isn't found or the account is inactive. Used to gate finance fields/writes
 * server-side per request: getBatches, getBatchDetails, updateBatchTracking,
 * updateShipmentFinance. Callers must trust `email` only when it was set by
 * the session-verified proxy layer, not a raw client-supplied field — see
 * server/app.ts's /api/apps-script-proxy.
 */
function getUserRole_(email) {
  var cleanEmail = String(email || '').toLowerCase().trim();
  if (!cleanEmail) return null;
  var users = getSheetData_('Users');
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (String(u.email || '').toLowerCase().trim() === cleanEmail) {
      if (String(u.is_active || '').toUpperCase() !== 'TRUE') return null;
      return u.role || null;
    }
  }
  return null;
}

/**
 * Returns a Set of SKUs that are flagged as BULK channel SKUs
 * (from the BULK_SKUs sheet). Used by runFullForecast for SS_BULK calculation.
 */
function getBulkSkuSet() {
  const bulkSet = new Set();
  try {
    const bulkData = getSheetData(SHEETS.bulk_skus);
    for (const row of bulkData) {
      if (!ArrayOfRow(row)) continue;
      const sku = getValue(row, SHEETS.bulk_skus, 'SKU');
      if (sku) bulkSet.add(sku);
    }
  } catch (err) {
    Logger.log('getBulkSkuSet: BULK_SKUs sheet not found or error — ' + err.message);
  }
  return bulkSet;
}

/**
 * Debug variant of runFullForecast — returns the same array plus a
 * debug_meta envelope. Falls back gracefully to normal forecast if no
 * debug-specific overrides are needed.
 */
function runForecastDebug(mode, e) {
  const startMs = Date.now();
  const data = runFullForecast(mode, e);
  return {
    debug: true,
    elapsed_ms: Date.now() - startMs,
    item_count: Array.isArray(data) ? data.length : 0,
    items: data
  };
}
