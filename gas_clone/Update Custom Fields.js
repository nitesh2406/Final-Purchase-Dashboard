function updateCustomFieldsFromSheet() {

  const sheetName = "Update Custom Fields";
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);

  const token = getEasyEcomToken();
  const url = "https://api.easyecom.io/Products/UpdateMasterProduct";

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const col = name => headers.indexOf(name);

  const IDX = {
    SKU: col("SKU"),
    EAN: col("EAN"),
    ARTICLE: col("Article Number"),
    LEAD: col("Lead_Time"),
    MOQ: col("MOQ"),
    THRESHOLD: col("Threshold_Qty"),
    SUPPLIER: col("Supplier_Code"),
    PACK_SIZE: col("Pack Size"),
    REMARK: col("Remark"),

    EXPLODE_EXCLUSION: col("EXPLODE_EXCLUSION"),
    EXCLUDE_LIST: col("EXCLUDE_LIST"),
    RMB_PRICE: col("RMB_PRICE")
  };

  // ✅ Mandatory column check
  if (IDX.SKU === -1) {
    throw new Error("SKU column not found");
  }

  // ✅ New fields validation
  if (IDX.EXPLODE_EXCLUSION === -1 || IDX.EXCLUDE_LIST === -1 || IDX.RMB_PRICE === -1) {
    throw new Error("One or more new columns (EXPLODE_EXCLUSION, EXCLUDE_LIST, RMB_PRICE) not found");
  }

  const apiHeaders = {
    "Authorization": "Bearer " + token,
    "x-api-key": PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY')
  };

  for (let i = 1; i < data.length; i++) {

    const row = data[i];
    const sku = row[IDX.SKU];

    if (!sku) continue;

    const payload = {
      sku: sku,
      size: row[IDX.PACK_SIZE],
      customFields: {
        "EAN": row[IDX.EAN],
        "Article Number": row[IDX.ARTICLE],
        "Lead_Time": row[IDX.LEAD],
        "MOQ": row[IDX.MOQ],
        "Threshold_Qty": row[IDX.THRESHOLD],
        "Supplier_Code": row[IDX.SUPPLIER],

        "EXPLODE_EXCLUSION": row[IDX.EXPLODE_EXCLUSION],
        "EXCLUDE_LIST": row[IDX.EXCLUDE_LIST],
        "RMB_PRICE": row[IDX.RMB_PRICE]
      }
    };

    // ✅ Remove empty fields (prevents API overwrite issues)
    Object.keys(payload.customFields).forEach(key => {
      if (payload.customFields[key] === "" || payload.customFields[key] == null) {
        delete payload.customFields[key];
      }
    });

    const options = {
      method: "post",
      headers: apiHeaders,
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {

      const response = UrlFetchApp.fetch(url, options);
      const text = response.getContentText();
      const json = JSON.parse(text);

      let remark = "";

      if (json.success || json.Success) {
        remark = "Updated Successfully";
      } else if (json.message) {
        remark = json.message;
      } else {
        remark = text;
      }

      sheet.getRange(i + 1, IDX.REMARK + 1).setValue(remark);

    } catch (error) {

      sheet.getRange(i + 1, IDX.REMARK + 1).setValue("Error: " + error.message);

    }

    Utilities.sleep(300); // Prevent API throttling
  }
}


// Returns [{sku, success, message}] — added for the SKU Update Requests
// approval flow (apiResolveSkuUpdateRequest, 18_newskuapi.gs) to know
// whether the push actually succeeded. Existing callers ignore the return
// value already, so this is purely additive. Same for the optional
// `ean` field on each item — only sent if provided, doesn't change the
// existing Article Number / AccountingSku / RMB Price logic at all.
function updateCustomFieldsSmart(dataArray) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName("EE Product Master");

  const masterData = masterSheet.getDataRange().getValues();
  const headers = masterData[0];

  const col = name => headers.indexOf(name);

  const IDX = {
    SKU: col("SKU"),
    ARTICLE: col("Article Number"),
  };

  const token = getEasyEcomToken();
  const url = "https://api.easyecom.io/Products/UpdateMasterProduct";

  const apiHeaders = {
    "Authorization": "Bearer " + token,
    "x-api-key": PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY')
  };

  // 🔥 SKU → Row Map
  const skuMap = {};

  for (let i = 1; i < masterData.length; i++) {
    const row = masterData[i];
    const sku = String(row[IDX.SKU]).trim();
    if (sku) skuMap[sku] = row;
  }

  const results = [];

  // ============================================
  // MAIN LOOP
  // ============================================

  dataArray.forEach(item => {

    const sku = String(item.sku).trim();
    const factoryCode = item.factory_code;
    const rmbPrice = item.rmb_price;
    const ean = item.ean;

    if (!sku || !skuMap[sku]) {
      Logger.log(`SKU not found: ${sku}`);
      results.push({ sku, success: false, message: 'SKU not found in EE Product Master' });
      return;
    }

    const masterRow = skuMap[sku];

    const existingArticle = masterRow[IDX.ARTICLE];

    let customFields = {};
    let accountingSku = "";

    // -----------------------------------
    // 🔥 LOGIC
    // -----------------------------------
    if (!existingArticle) {
      if (factoryCode) {
        customFields["Article Number"] = factoryCode;
      }
    } else {
      if (factoryCode) {
        accountingSku = factoryCode;
      }
    }

    // Always update RMB Price
    if (rmbPrice !== undefined && rmbPrice !== "") {
      customFields["RMB_PRICE"] = rmbPrice;
    }

    // Optional EAN — additive, doesn't affect Article Number/AccountingSku logic
    if (ean !== undefined && ean !== "") {
      customFields["EAN"] = ean;
    }


    if (Object.keys(customFields).length === 0 && !accountingSku) {
      Logger.log(`No update needed for ${sku}`);
      results.push({ sku, success: false, message: 'No fields to update' });
      return;
      }


    const payload = {
      sku: sku,
      customFields: customFields
      };
    // ✅ Add accounting_sku ONLY if needed
    if (accountingSku) {
      payload["AccountingSku"] = accountingSku;
    }

    Logger.log(payload);

    const options = {
      method: "post",
      headers: apiHeaders,
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {

      const response = UrlFetchApp.fetch(url, options);
      const resText = response.getContentText();
      const json = JSON.parse(resText);

      if (isEeSuccess_(json)) {
        Logger.log(`✅ Updated: ${sku}`);
        results.push({ sku, success: true, message: json.message || 'Updated successfully' });
      } else {
        Logger.log(`❌ Failed: ${sku} → ${resText}`);
        results.push({ sku, success: false, message: json.message || resText });
      }

    } catch (e) {
      Logger.log(`ERROR ${sku}: ${e.message}`);
      results.push({ sku, success: false, message: e.message });
    }

    Utilities.sleep(300);
  });

  return results;
}

function test_updateCustomFieldsSmart() {

  const data = [
    {
      sku: "1030400",
      factory_code: "EQY10002",
      rmb_price: 5
    }
  ];

  updateCustomFieldsSmart(data);
}