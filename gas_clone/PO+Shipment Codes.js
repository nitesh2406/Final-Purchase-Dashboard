function apiSubmitDraft_(payload) {
  const { draftId, vendors } = payload;
  if (!draftId) throw new Error("draftId is required");
  if (!Array.isArray(vendors) || vendors.length === 0) {
    throw new Error("At least one vendor must be selected");
  }

  const now = new Date();
  const userEmail = Session.getActiveUser().getEmail();

  // =========================
  // Sheets & headers
  // =========================
  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);

  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);

  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);

  const poLineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const poLineHeader = getHeaderMap_(poLineSheet);

  const vendorSheet = getSheet_(SHEET_NAMES.VENDOR_MASTERS);
  const vendorHeader = getHeaderMap_(vendorSheet);
  const vendorData = vendorSheet.getDataRange().getValues();

  // Was: generatePoId_(vendorCode, now) re-read the ENTIRE Purchase_Orders
  // sheet from scratch for every vendor in this submission, purely to find
  // the next sequence number for that vendor+date prefix. One shared read
  // here, reused by nextPoId_ below for every vendor — same lookup logic,
  // same result, one round trip total instead of one per vendor.
  const poDataForIds_ = poSheet.getDataRange().getValues();
  function nextPoId_(vendorCode) {
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const prefix = `PO-${vendorCode}${yy}${mm}${dd}-`;
    let maxSeq = 0;
    for (let i = 1; i < poDataForIds_.length; i++) {
      const poId = String(poDataForIds_[i][poHeader.po_id] || '');
      if (poId.startsWith(prefix)) {
        const parts = poId.split('-');
        const seq = Number(parts[parts.length - 1]);
        if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
      }
    }
    return `${prefix}${maxSeq + 1}`;
  }

  // =========================
  // 1️⃣ Fetch & validate draft
  // =========================
  const draftData = draftSheet.getDataRange().getValues();
  let draftRow = null;

  for (let i = 1; i < draftData.length; i++) {
    if (String(draftData[i][draftHeader.draft_id]).trim() === draftId) {
      draftRow = draftData[i];
      break;
    }
  }

  if (!draftRow) throw new Error(`Draft not found: ${draftId}`);
  if (draftRow[draftHeader.status] !== "DRAFT") {
    throw new Error("Draft is locked after submission");
  }

  const plannedMode = draftRow[draftHeader.planned_mode];

  // =========================
  // 2️⃣ Collect draft lines by vendor
  // =========================
  const lineData = lineSheet.getDataRange().getValues();
  const vendorGroups = {}; // vendor_code → lines[]

  for (let i = 1; i < lineData.length; i++) {
    const row = lineData[i];
    if (String(row[lineHeader.draft_id]).trim() !== draftId) continue;

    const vendorCode = row[lineHeader.vendor_code];
    if (!vendors.includes(vendorCode)) continue;

    if (!vendorGroups[vendorCode]) vendorGroups[vendorCode] = [];
    vendorGroups[vendorCode].push(row);
  }

  const vendorsWithLines = Object.keys(vendorGroups);
  if (vendorsWithLines.length === 0) {
    throw new Error("Selected vendors have no draft lines");
  }

  // =========================
  // 3️⃣ Build vendor email lookup
  // =========================
  const vendorEmailMap = {};
  for (let i = 1; i < vendorData.length; i++) {
    const row = vendorData[i];
    const vCode = row[vendorHeader.vendor_code];
    if (!vCode) continue;

    vendorEmailMap[vCode] = {
      to: row[vendorHeader.primary_email] || "",
      cc: row[vendorHeader.cc_emails] || ""
    };
  }

  // =========================
  // 4️⃣ Create POs + PO Lines
  // =========================
  const createdPOs = [];

  vendorsWithLines.forEach(vendorCode => {
    //const poId = "PO-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    const poId = nextPoId_(vendorCode);

    const lines = vendorGroups[vendorCode];

    let totalQty = 0;
    lines.forEach(l => {
      totalQty += Number(l[lineHeader.qty] || 0);
    });

    // ---- PO Header
    appendRowFromObject_(poSheet, poHeader, {
      po_id: poId,
      draft_id: draftId,
      po_date: now,
      planned_mode: plannedMode,
      vendor_code: vendorCode,
      total_skus: lines.length,
      total_qty: totalQty,
      po_status: "OPEN",
      email_status: "NOT_SENT",
      created_by: userEmail,
      created_at: now,
      updated_at: now
    });

    // ---- PO Lines
    // Was: one appendRow() per line item (15 lines = 15 round trips). Now
    // one setValues() call for this vendor's whole line set — same fields,
    // same values, same order, just written together. Written per-vendor
    // (not batched across the whole multi-vendor submission) because
    // sendPoEmailAndLog_ below reads these lines straight back from the
    // sheet to build the vendor's email — it needs to see them already
    // written before it runs.
    const vendorLineRows = lines.map(l => {
      const qty = Number(l[lineHeader.qty] || 0);
      const price = Number(l[lineHeader.unit_price] || 0);
      return buildRowFromObject_(poLineHeader, {
        po_line_id: Utilities.getUuid(),
        po_id: poId,
        sku: l[lineHeader.sku],
        sku_name: l[lineHeader.sku_name],
        vendor_code: vendorCode,
        ordered_qty: qty,
        unit_price_rmb: price,
        line_total_rmb: qty * price,

        custom_logo: l[lineHeader.custom_logo],
        custom_packaging: l[lineHeader.custom_packaging],
        solving_manual: l[lineHeader.solving_manual],
        opp_wrap: l[lineHeader.opp_wrap],
        custom_remarks: l[lineHeader.custom_remarks],
        customization_files: l[lineHeader.customization_files],

        line_status: "OPEN",
        fulfilled_qty: 0,
        created_at: now,
        updated_at: now
      });
    });
    if (vendorLineRows.length > 0) {
      const startRow = poLineSheet.getLastRow() + 1;
      poLineSheet.getRange(startRow, 1, vendorLineRows.length, vendorLineRows[0].length).setValues(vendorLineRows);
    }

    // =========================
    // 5️⃣ Send Email + Log
    // =========================
    const emailInfo = vendorEmailMap[vendorCode] || { to: "", cc: "" };
    sendPoEmailAndLog_(
      poId,
      vendorCode,
      emailInfo.to,
      emailInfo.cc,
      userEmail
    );

    createdPOs.push(poId);
  });

  // =========================
  // 6️⃣ Update draft status
  // =========================
  updateRowByKey_(draftSheet, draftHeader, "draft_id", draftId, {
    status:
      vendorsWithLines.length === vendors.length
        ? "SUBMITTED"
        : "PARTIALLY_SUBMITTED",
    updated_at: now
  });

  return {
    success: true,
    draftId,
    newPOs: createdPOs,
    message: "Purchase Orders created successfully"
  };
}

//// -----------------------------Claude Code Starts Here------------------

/**
 * API: Create Purchase Orders directly for unallocated shipment items,
 * skipping the Draft Order stage entirely.
 * Reuses the same PO numbering, PO/PO-line creation and email pipeline
 * as apiSubmitDraft_, grouped by vendor_code, with per-vendor error
 * isolation so one vendor's failure doesn't affect the others.
 */
function apiCreatePOsForUnallocatedItems_(payload) {
  const { mode, lines } = payload;

  if (!mode) throw new Error("Shipping mode is required");
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("At least one line item is required");
  }

  lines.forEach((line, idx) => {
    if (!line.sku) throw new Error(`SKU missing at line ${idx + 1}`);
    if (!line.vendor_code) throw new Error(`Vendor missing for SKU ${line.sku}`);
    if (!line.qty || Number(line.qty) <= 0) {
      throw new Error(`Invalid quantity for SKU ${line.sku}`);
    }
  });

  const now = new Date();
  const userEmail = Session.getActiveUser().getEmail();

  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);

  const poLineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const poLineHeader = getHeaderMap_(poLineSheet);

  // Group lines by vendor_code
  const vendorGroups = {};
  lines.forEach(line => {
    const vendorCode = line.vendor_code;
    if (!vendorGroups[vendorCode]) vendorGroups[vendorCode] = [];
    vendorGroups[vendorCode].push(line);
  });

  const results = [];

  Object.keys(vendorGroups).forEach(vendorCode => {
    const vendorLines = vendorGroups[vendorCode];

    try {
      const poId = generatePoId_(vendorCode, now);

      let totalQty = 0;
      vendorLines.forEach(l => {
        totalQty += Number(l.qty || 0);
      });

      appendRowFromObject_(poSheet, poHeader, {
        po_id: poId,
        draft_id: "",
        po_date: now,
        planned_mode: String(mode).toUpperCase(),
        vendor_code: vendorCode,
        total_skus: vendorLines.length,
        total_qty: totalQty,
        po_status: "OPEN",
        email_status: "NOT_SENT",
        created_by: userEmail,
        created_at: now,
        updated_at: now
      });

      vendorLines.forEach(l => {
        const qty = Number(l.qty || 0);
        const price = Number(l.unit_price || 0);

        appendRowFromObject_(poLineSheet, poLineHeader, {
          po_line_id: Utilities.getUuid(),
          po_id: poId,
          sku: l.sku,
          sku_name: l.sku_name || "",
          vendor_code: vendorCode,
          ordered_qty: qty,
          unit_price_rmb: price,
          line_total_rmb: qty * price,

          custom_logo: l.custom_logo || false,
          custom_packaging: l.custom_packaging || false,
          solving_manual: l.solving_manual || false,
          opp_wrap: l.opp_wrap || false,
          custom_remarks: l.custom_remarks || "",
          customization_files: l.customization_files || "",

          line_status: "OPEN",
          fulfilled_qty: 0,
          created_at: now,
          updated_at: now
        });
      });

      // Deliberately no sendPoEmailAndLog_ call here: these POs are created for
      // SKUs the vendor already shipped as extras beyond the original PO, purely
      // so we have an internal record. Emailing the vendor made them think it was
      // a new order and re-process it. email_status stays "NOT_SENT" above.

      logAuditEvent_('PURCHASE_ORDER', 'CREATE', poId, `${vendorLines.length} SKU(s), qty ${totalQty} for ${vendorCode}`, 'SUCCESS', userEmail);

      results.push({
        vendor_code: vendorCode,
        po_id: poId,
        sku_count: vendorLines.length,
        total_qty: totalQty,
        success: true
      });
    } catch (err) {
      Logger.log(`apiCreatePOsForUnallocatedItems_ error for vendor ${vendorCode}: ${err.message}`);
      logAuditEvent_('PURCHASE_ORDER', 'CREATE', vendorCode, err.message, 'FAILED', userEmail);
      results.push({
        vendor_code: vendorCode,
        success: false,
        error: err.message
      });
    }
  });

  return {
    status: 'success',
    results: results,
    message: "Purchase Orders created"
  };
}

function sendPoEmailAndLog_(poId, vendorCode, emailTo, emailCc, createdBy) {
  const now = new Date();

  const logSheet = getSheet_(SHEET_NAMES.PO_EMAIL_LOG);
  const logHeader = getHeaderMap_(logSheet);
  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  const poLineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const poLineHeader = getHeaderMap_(poLineSheet);

  // Fetch vendor name
  const vendorSheet = getSheet_(SHEET_NAMES.VENDOR_MASTERS);
  const vendorHeader = getHeaderMap_(vendorSheet);
  const vendorData = vendorSheet.getDataRange().getValues();
  let vendorName = vendorCode;
  for (let i = 1; i < vendorData.length; i++) {
    if (String(vendorData[i][vendorHeader.vendor_code]).trim() === vendorCode) {
      vendorName = vendorData[i][vendorHeader.vendor_name] || vendorCode;
      break;
    }
  }

  // Fetch Article Numbers from EE Product Master
  const productData = getSheetData(SHEETS.products);
  const articleMap = new Map();
  for (const row of productData) {
    const sku = getValue(row, SHEETS.products, 'SKU');
    const articleNo = getValue(row, SHEETS.products, 'Article Number') || '-';
    if (sku) articleMap.set(sku, articleNo);
  }

  // Fetch PO lines
  const poLineData = poLineSheet.getDataRange().getValues();
  const lines = [];
  for (let i = 1; i < poLineData.length; i++) {
    if (String(poLineData[i][poLineHeader.po_id]).trim() === poId) {
      lines.push(poLineData[i]);
    }
  }

  // Calculate total qty
  let totalQty = 0;
  lines.forEach(l => {
    totalQty += Number(l[poLineHeader.ordered_qty] || 0);
  });

  // Format date
  const poDate = Utilities.formatDate(
    now, Session.getScriptTimeZone(), 'dd MMM yyyy'
  );

  // ── Build CSV content ──────────────────────────────────────────
  const csvRows = [
    [
      'Purchase Order ID', 'SKU', 'Article Number', 'Itemname',
      'Qty', 'Custom Logo', 'Custom Packaging', 'Solving Manual',
      'OPP Wrap', 'Other Remarks', 'Customization Files'
    ]
  ];

  lines.forEach(l => {
    const sku = l[poLineHeader.sku] || '';
    csvRows.push([
      poId,
      sku,
      articleMap.get(sku) || '-',
      l[poLineHeader.sku_name] || '',
      Number(l[poLineHeader.ordered_qty] || 0),
      l[poLineHeader.custom_logo] ? 'Yes' : 'No',
      l[poLineHeader.custom_packaging] ? 'Yes' : 'No',
      l[poLineHeader.solving_manual] ? 'Yes' : 'No',
      l[poLineHeader.opp_wrap] ? 'Yes' : 'No',
      l[poLineHeader.custom_remarks] || '-',
      l[poLineHeader.customization_files] || '-'
    ]);
  });

  const csvContent = csvRows.map(row =>
    row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')
  ).join('\n');

  const csvBlob = Utilities.newBlob(
    csvContent,
    'text/csv',
    `Purchase_Orders_${vendorCode}_${poId}.csv`
  );

// ── Build Drive folder attachments ────────────────────────────
const driveAttachments = [];
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20MB in bytes
let totalAttachmentSize = 0;
let attachmentLimitReached = false;

lines.forEach(l => {
  if (attachmentLimitReached) return;

  const fileUrl = l[poLineHeader.customization_files] || '';
  if (!fileUrl) return;

  try {
    const match = fileUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (!match) return;

    const folderId = match[1];
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();
      const fileSize = file.getSize();

      if (totalAttachmentSize + fileSize > MAX_ATTACHMENT_SIZE) {
        attachmentLimitReached = true;
        Logger.log(
          'Attachment size limit reached at SKU: ' 
          + l[poLineHeader.sku] 
          + ' | Total so far: ' 
          + (totalAttachmentSize / 1024 / 1024).toFixed(2) + 'MB'
        );
        break;
      }

      driveAttachments.push(file.getBlob());
      totalAttachmentSize += fileSize;
    }

  } catch (err) {
    Logger.log(
      'Drive attachment error for SKU ' 
      + l[poLineHeader.sku] + ': ' + err.message
    );
  }
});

if (attachmentLimitReached) {
  Logger.log(
    'Some Drive files were not attached — size limit exceeded. '
    + 'Total attached: ' 
    + (totalAttachmentSize / 1024 / 1024).toFixed(2) + 'MB'
    + ' | Drive links still visible in email table.'
  );
}

  // ── Build SKU rows HTML ───────────────────────────────────────
  const yesStyle = `
    display:inline-block; background:#dc2626; color:#fff;
    font-weight:700; font-size:12px; padding:2px 10px;
    border-radius:4px;`;
  const noStyle = `
    display:inline-block; background:#e2e8f0; color:#64748b;
    font-size:12px; padding:2px 10px; border-radius:4px;`;

  const skuRows = lines.map(l => {
    const sku = l[poLineHeader.sku] || '';
    const articleNo = articleMap.get(sku) || '-';
    const skuName = l[poLineHeader.sku_name] || '';
    const qty = Number(l[poLineHeader.ordered_qty] || 0);
    const remarks = l[poLineHeader.custom_remarks] || '-';
    const fileUrl = l[poLineHeader.customization_files] || '';

    const badge = (val) => val
      ? `<span style="${yesStyle}">Yes</span>`
      : `<span style="${noStyle}">No</span>`;

    const fileCell = fileUrl
      ? `<a href="${fileUrl}" 
            style="color:#2563eb; font-size:12px; word-break:break-all;">
           ${fileUrl}
         </a>`
      : '-';

    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding:10px 12px; font-size:12px; color:#334155;
                   border-right:1px solid #e2e8f0;">${poId}</td>
        <td style="padding:10px 12px; font-family:monospace;
                   font-size:12px; color:#334155;
                   border-right:1px solid #e2e8f0;">${sku}</td>
        <td style="padding:10px 12px; font-size:12px; color:#334155;
                   border-right:1px solid #e2e8f0;">${articleNo}</td>
        <td style="padding:10px 12px; font-size:12px; color:#1e293b;
                   border-right:1px solid #e2e8f0;">${skuName}</td>
        <td style="padding:10px 12px; text-align:center;
                   font-size:13px; font-weight:600; color:#1e293b;
                   border-right:1px solid #e2e8f0;">${qty}</td>
        <td style="padding:10px 12px; text-align:center;
                   border-right:1px solid #e2e8f0;">${badge(l[poLineHeader.custom_logo])}</td>
        <td style="padding:10px 12px; text-align:center;
                   border-right:1px solid #e2e8f0;">${badge(l[poLineHeader.custom_packaging])}</td>
        <td style="padding:10px 12px; text-align:center;
                   border-right:1px solid #e2e8f0;">${badge(l[poLineHeader.solving_manual])}</td>
        <td style="padding:10px 12px; text-align:center;
                   border-right:1px solid #e2e8f0;">${badge(l[poLineHeader.opp_wrap])}</td>
        <td style="padding:10px 12px; text-align:center;
                   font-size:12px; color:#64748b;
                   border-right:1px solid #e2e8f0;">${remarks}</td>
        <td style="padding:10px 12px; font-size:12px;">
          ${fileCell}
        </td>
      </tr>`;
  }).join('');

  // ── Build HTML from template ──────────────────────────────────
  const htmlTemplate = HtmlService
    .createTemplateFromFile('POEmailTemplate');
  htmlTemplate.PO_ID = poId;
  htmlTemplate.PO_DATE = poDate;
  htmlTemplate.VENDOR_NAME = vendorName;
  htmlTemplate.TOTAL_QTY = totalQty;
  htmlTemplate.SKU_ROWS = skuRows;
  const htmlBody = htmlTemplate.evaluate().getContent();

  // ── Send email ────────────────────────────────────────────────
  try {
    if (emailTo) {
      const allAttachments = [csvBlob, ...driveAttachments];

      GmailApp.sendEmail(
        emailTo,
        `Purchase Order from Cubelelo | PO ID: ${poId}`,
        // Plain text fallback
        `Dear ${vendorName},\n\n`
        + `Please find below the details of your confirmed purchase `
        + `order from Cubelelo. Kindly process the same at the earliest.\n\n`
        + `PO ID: ${poId}\nDate: ${poDate}\nTotal Units: ${totalQty}\n\n`
        + `Regards,\nTeam Cubelelo`,
        {
          from: 'procurement@cubelelo.com',
          cc: emailCc || '',
          htmlBody: htmlBody,
          name: 'Cubelelo Procurement',
          attachments: allAttachments
        }
      );
    }

    // Update PO email status
    updateRowByKey_(poSheet, poHeader, 'po_id', poId, {
      email_status: 'SENT',
      updated_at: now
    });

    // Log success
    appendRowFromObject_(logSheet, logHeader, {
      log_id: Utilities.getUuid(),
      po_id: poId,
      vendor_code: vendorCode,
      email_to: emailTo,
      email_cc: emailCc,
      email_status: 'SENT',
      sent_at: now,
      created_by: createdBy,
      created_at: now
    });

  } catch (e) {
    Logger.log('sendPoEmailAndLog_ error: ' + e.message);

    appendRowFromObject_(logSheet, logHeader, {
      log_id: Utilities.getUuid(),
      po_id: poId,
      vendor_code: vendorCode,
      email_to: emailTo,
      email_cc: emailCc,
      email_status: 'FAILED',
      error_message: e.message,
      created_by: createdBy,
      created_at: now
    });
  }
}

/*function apiGetPurchaseOrders_(payload) {
  const sheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    rows.push({
      po_id: r[header.po_id],
      draft_id: r[header.draft_id],
      po_date: r[header.po_date],
      planned_mode: r[header.planned_mode],
      vendor_code: r[header.vendor_code],
      total_skus: r[header.total_skus],
      total_qty: r[header.total_qty],
      po_status: r[header.po_status],
      email_status: r[header.email_status]
    });
  }

  return {
    success: true,
    data: rows
  };
}*/

// List view is a full-sheet scan (POs + PO lines); cached briefly so bursts of
// concurrent calls (multiple tabs, page reloads) don't each pay the ~4s scan cost
// and collide with Apps Script's per-project concurrent execution limit. Detail
// lookups (apiGetPurchaseOrderDetails_) stay uncached/live. Force-refresh in the
// UI still hits this same cache — a 60s ceiling on staleness is an acceptable
// trade for a summary list that already has a manual "Sync" affordance.
var PO_LIST_CACHE_KEY_ = 'po_list_summary_v1';
var PO_LIST_CACHE_TTL_SECONDS_ = 60;

function apiGetPurchaseOrders_(payload) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PO_LIST_CACHE_KEY_);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  const poData = poSheet.getDataRange().getValues();

  const lineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();

  // Build fulfillment totals map: po_id → { ordered, fulfilled }
  const fulfillmentMap = {};
  for (let i = 1; i < lineData.length; i++) {
    const poId = String(lineData[i][lineHeader.po_id] || '').trim();
    if (!poId) continue;
    if (!fulfillmentMap[poId]) fulfillmentMap[poId] = { ordered: 0, fulfilled: 0 };
    fulfillmentMap[poId].ordered   += Number(lineData[i][lineHeader.ordered_qty]   || 0);
    fulfillmentMap[poId].fulfilled += Number(lineData[i][lineHeader.fulfilled_qty] || 0);
  }

  const rows = [];
  for (let i = 1; i < poData.length; i++) {
    const r = poData[i];
    const poId = String(r[poHeader.po_id] || '').trim();
    if (!poId) continue;
    const fm = fulfillmentMap[poId] || { ordered: 0, fulfilled: 0 };
    rows.push({
      po_id:                poId,
      draft_id:             r[poHeader.draft_id],
      po_date:              r[poHeader.po_date] ? new Date(r[poHeader.po_date]).toISOString() : '',
      planned_mode:         r[poHeader.planned_mode],
      vendor_code:          r[poHeader.vendor_code],
      total_skus:           r[poHeader.total_skus],
      total_qty:            r[poHeader.total_qty],
      po_status:            r[poHeader.po_status],
      email_status:         r[poHeader.email_status],
      total_ordered_qty:    fm.ordered,
      total_fulfilled_qty:  fm.fulfilled
    });
  }

  const result = { success: true, data: rows };
  try {
    const serialized = JSON.stringify(result);
    if (serialized.length < 95000) cache.put(PO_LIST_CACHE_KEY_, serialized, PO_LIST_CACHE_TTL_SECONDS_);
  } catch (e) {}

  return result;
}

function apiGetPurchaseOrderDetails_(payload) {
  const { po_id } = payload;
  if (!po_id) throw new Error("po_id is required");

  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  const poData = poSheet.getDataRange().getValues();

  let po = null;

  for (let i = 1; i < poData.length; i++) {
    if (poData[i][poHeader.po_id] === po_id) {
      po = {};
      Object.keys(poHeader).forEach(k => {
        po[k] = poData[i][poHeader[k]];
      });
      break;
    }
  }

  if (!po) throw new Error(`PO not found: ${po_id}`);

  const lineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();

  const lines = [];

  for (let i = 1; i < lineData.length; i++) {
    if (lineData[i][lineHeader.po_id] === po_id) {
      const l = {};
      Object.keys(lineHeader).forEach(k => {
        l[k] = lineData[i][lineHeader[k]];
      });
      lines.push(l);
    }
  }

  return {
    success: true,
    po,
    lines
  };
}


function generatePoId_(vendorCode, now) {
  const sheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  const dateKey = `${yy}${mm}${dd}`;
  const prefix = `PO-${vendorCode}${dateKey}-`;

  let maxSeq = 0;

  for (let i = 1; i < data.length; i++) {
    const poId = String(data[i][header.po_id] || '');
    if (poId.startsWith(prefix)) {
      const parts = poId.split('-');
      const seq = Number(parts[parts.length - 1]);
      if (!isNaN(seq)) {
        maxSeq = Math.max(maxSeq, seq);
      }
    }
  }

  return `${prefix}${maxSeq + 1}`;
}


//---------------------------------Shipment Uploading Code with SKU Matching -----------------------------

/**
 * API: Upload & Normalize Vendor Shipment with SKU Matching
 * Phase: Setup + Validation + SKU Matching
 *
 * NEW FEATURES:
 * - Priority-based column mapping with fallback
 * - Factory code concatenation for multiple sources
 * - EE Product Master lookup (EAN → Article Number → Other Factory Code)
 * - SKU cross-checking with vendor-provided SKU
 * - Filter out total/summary rows
 */
function apiUploadAndNormalizeVendorShipment(payload) {
  validateUploadPayload_(payload);

  const shipmentId = createVendorShipmentHeader_(payload);

  const allNormalizedRows = [];
  const issues = [];

  payload.files.forEach((file) => {
    const rawRows = file.rows || [];
    if (!rawRows.length) return;

    // Frontend handles all column detection — always passthrough
    const normalizedRows = rawRows.map((row, index) => ({
      ...row,
      line_id: `LINE-${Date.now()}-${index + 1}`,
      source_file_name: file.fileName,
      document_type: file.documentType
    }));

    allNormalizedRows.push(...normalizedRows);
  }); // ← closing brace was missing

  const productMaster = loadEEProductMaster_();
  const matchedRows = performSKUMatching_(allNormalizedRows, productMaster);

  updateVendorShipmentStatus_(shipmentId, 'NORMALIZED');

  return {
    status: 'success',
    shipmentId,
    rows: matchedRows,
    issues
  };
}

function validateUploadPayload_(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');

  if (!payload.vendorCode) throw new Error('vendorCode missing');
  if (!payload.shipmentDate) throw new Error('shipmentDate missing');

  if (!Array.isArray(payload.files) || payload.files.length === 0) {
    throw new Error('No files uploaded');
  }

  payload.files.forEach((file, index) => {
    if (!file.fileName) throw new Error(`fileName missing for file #${index + 1}`);
    if (!file.documentType) throw new Error(`documentType missing for file #${index + 1}`);
    if (!Array.isArray(file.rows)) throw new Error(`rows missing or invalid for file #${index + 1}`);
    if (file.rows.length === 0) throw new Error(`No rows found in file #${index + 1}`);
  });
}

function createVendorShipmentHeader_(payload) {
  const sheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENTS);
  const header = getHeaderMap_(sheet);
  const shipmentId = `VS-${Date.now()}`;

  appendRowFromObject_(sheet, header, {
    shipment_id: shipmentId,
    batch_id: '',
    vendor_code: payload.vendorCode || '',
    po_id: payload.poId || '',
    status: 'NORMALIZED',
    invoice_no: payload.invoiceReference || '',
    invoice_date: payload.shipmentDate || '',
    total_amount: 0,
    carton_count: 0,
    carrier: '',
    expected_delivery: '',
    remarks: payload.remarks || '',
    created_at: new Date(),
    submitted_at: ''
  });

  return shipmentId;
}

function updateVendorShipmentStatus_(shipmentId, status) {
  const sheet = getSheet_('Vendor_Shipments');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const idCol = headers.indexOf('shipment_id');
  const statusCol = headers.indexOf('status');

  if (idCol === -1 || statusCol === -1) {
    throw new Error('Vendor_Shipments sheet is missing shipment_id/status columns');
  }

  for (let r = 1; r < values.length; r++) {
    if (values[r][idCol] === shipmentId) {
      sheet.getRange(r + 1, statusCol + 1).setValue(status);
      return;
    }
  }

  throw new Error(`Shipment not found: ${shipmentId}`);
}

/**
 * API: Record the Google Drive folder holding a shipment's uploaded documents.
 * Metadata only — the Node backend performs the actual Drive upload; this
 * just stores the resulting URL/ID strings on the Vendor_Shipments row,
 * the same way `customization_files` already stores a plain Drive link.
 * Requires `drive_folder_id` / `drive_folder_url` columns to exist on the
 * Vendor_Shipments sheet (added manually to the header row).
 */
function apiUpdateShipmentDriveDocs(payload) {
  const { shipmentId, driveFolderId, driveFolderUrl } = payload;
  if (!shipmentId) throw new Error('shipmentId is required');

  const sheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENTS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const idCol = headers.indexOf('shipment_id');
  const folderIdCol = headers.indexOf('drive_folder_id');
  const folderUrlCol = headers.indexOf('drive_folder_url');

  if (idCol === -1) {
    throw new Error('Vendor_Shipments sheet is missing the shipment_id column');
  }
  if (folderIdCol === -1 || folderUrlCol === -1) {
    throw new Error('Vendor_Shipments sheet is missing drive_folder_id/drive_folder_url columns — add them to the header row first');
  }

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]).trim() === String(shipmentId).trim()) {
      if (driveFolderId !== undefined) sheet.getRange(r + 1, folderIdCol + 1).setValue(driveFolderId);
      if (driveFolderUrl !== undefined) sheet.getRange(r + 1, folderUrlCol + 1).setValue(driveFolderUrl);
      return { status: 'success', shipmentId };
    }
  }

  throw new Error(`Shipment not found: ${shipmentId}`);
}

// ========================== SKU MATCHING FUNCTIONS ==========================

/**
 * Calculate price difference percentage — straight RMB-to-RMB comparison.
 * (2026-08 fix: this used to scale invoicePrice by an RMB->INR convRate
 * before comparing it to masterCost, which is itself RMB (RMB_Price column,
 * see loadEEProductMaster_) — comparing an INR-scaled figure to an RMB one
 * inflated every diff by ~17x, so virtually every row failed this check
 * regardless of actual price accuracy. Removed; both sides are RMB now.)
 */
function calculatePriceDiffPercentage_(invoicePrice, masterCost) {
  if (!masterCost || masterCost === 0) return 0;

  const diff = invoicePrice - masterCost;
  const percentage = (diff / masterCost) * 100;

  return Math.abs(percentage);
}

/**
 * Check if match should be flagged as PARTIAL_MATCH.
 * Name-similarity checking was removed (2026-08) — it was too unreliable to
 * cross-verify against vendor-supplied names in practice. Price variance
 * against master cost is the only remaining Phase 2 trigger.
 */
function checkPartialMatch_(row, matchResult, invoicePrice) {
  const vendorSKU = row.sku && String(row.sku).trim() !== '' ? String(row.sku).trim() : null;

  if (vendorSKU) {
    return { isPartial: false, reason: '', priceDiff: 0 };
  }

  const priceDiff = calculatePriceDiffPercentage_(invoicePrice, matchResult.cost);
  const PRICE_THRESHOLD = 30;

  const isPartial = priceDiff > PRICE_THRESHOLD;

  return {
    isPartial,
    reason: isPartial ? 'Price variance' : '',
    priceDiff: Math.round(priceDiff)
  };
}

/**
 * Load EE Product Master sheet
 * Returns array of product objects with all fields
 */
function loadEEProductMaster_() {
  const sheet = getSheet_('EE Product Master');
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];

  const headers = rows[0];
  const idx = (h) => headers.indexOf(h);

  return rows.slice(1).map(r => ({
    productId: String(r[idx('Product ID')] || '').trim(),
    sku: String(r[idx('SKU')] || '').trim(),
    productName: String(r[idx('Product Name')] || '').trim(),
    // 'EE Scan Identifier' is EasyEcom's real "EAN/UPC" product field, synced via
    // the API (see EEcom_api_code.js). The sheet's separate 'EAN' column was manual
    // web-app data entry and is deliberately no longer used for matching (2026-08).
    ean: String(r[idx('EE Scan Identifier')] || '').trim(),
    articleNumber: String(r[idx('Article Number')] || '').trim(),
    otherFactoryCode: String(r[idx('Other Factory Item Code')] || '').trim(),
    // RMB_Price (the vendor's RMB purchase cost), not Cost (INR landed
    // cost) — every consumer of this field does a direct RMB-to-RMB
    // comparison against the invoice's unit price (see calculatePriceDiff
    // in VendorShipments.tsx and calculatePriceDiffPercentage_ below).
    cost: Number(r[idx('RMB_Price')]) || 0,
    brand: String(r[idx('Brand')] || '').trim(),
    category: String(r[idx('Category Name')] || '').trim(),
    leadTime: Number(r[idx('Lead_Time')]) || 0,
    moq: Number(r[idx('MOQ')]) || 0
  })).filter(p => p.sku); // Only include rows with valid SKU
}

/**
 * Match SKU by EAN
 * Returns matched product or null
 */
function matchSKUByEAN_(ean, productMaster) {
  if (!ean || String(ean).trim() === '') return null;
  
  const cleanEAN = String(ean).trim();
  
  for (const product of productMaster) {
    if (product.ean === cleanEAN) {
      return {
        ...product,
        matchedBy: 'EAN',
        matchedCode: cleanEAN,
        matchConfidence: 'HIGH'
      };
    }
  }
  
  return null;
}

/**
 * Match SKU by Factory Code
 * Searches in Article Number, then Other Factory Item Code
 * Returns matched product or null
 */
function matchSKUByFactoryCode_(factoryCode, productMaster) {
  if (!factoryCode || String(factoryCode).trim() === '') return null;
  
  const cleanCode = String(factoryCode).trim();
  
  // Try Article Number first
  for (const product of productMaster) {
    if (product.articleNumber === cleanCode) {
      return {
        ...product,
        matchedBy: 'ARTICLE_NUMBER',
        matchedCode: cleanCode,
        matchConfidence: 'MEDIUM'
      };
    }
  }
  
  // Try Other Factory Item Code
  for (const product of productMaster) {
    if (product.otherFactoryCode === cleanCode) {
      return {
        ...product,
        matchedBy: 'OTHER_FACTORY_CODE',
        matchedCode: cleanCode,
        matchConfidence: 'MEDIUM'
      };
    }
  }
  
  return null;
}

/**
 * Detect duplicate EANs in the batch
 * Returns: Map of EAN → count
 * Purpose: Identify potential variant issues (same EAN, multiple products)
 */
function detectDuplicateEANs_(normalizedRows) {
  const eanCounts = {};
  
  normalizedRows.forEach(row => {
    if (row.ean && String(row.ean).trim() !== '') {
      const ean = String(row.ean).trim();
      eanCounts[ean] = (eanCounts[ean] || 0) + 1;
    }
  });
  
  return eanCounts;
}

/**
 * Perform SKU matching for all normalized rows
 * Main matching orchestrator
 * 
 * Logic:
 * 1. Try EAN match first (highest priority)
 * 2. Try factory codes in priority order
 * 3. Check for SKU mismatch if vendor SKU exists
 * 4. Check for partial match if vendor SKU missing (name + price validation)
 * 5. Set appropriate match status
 */
/*function performSKUMatching_(normalizedRows, productMaster) {
  // NEW: Detect duplicate EANs first
  const eanCounts = detectDuplicateEANs_(normalizedRows);
  
  return normalizedRows.map(row => {
    let matchResult = null;
    let matchedProducts = [];
    
    const vendorSKU = row.sku && String(row.sku).trim() !== '' ? String(row.sku).trim() : null;
    const invoicePrice = Number(row.unit_price) || 0;
    
    // Step 1: Try EAN match first
    if (row.ean) {
      matchResult = matchSKUByEAN_(row.ean, productMaster);
      if (matchResult) {
        // NEW: Check if this EAN appears multiple times without vendor SKU
        // This indicates potential variant issue (e.g., same product different sizes)
        if (eanCounts[row.ean] > 1 && !vendorSKU) {
          return enrichRowWithMatch_(row, matchResult, 'MULTIPLE_VARIANT');
        }
        
        // Check for SKU mismatch (if vendor SKU exists)
        if (vendorSKU && matchResult.sku !== vendorSKU) {
          return enrichRowWithMatch_(row, matchResult, 'SKU_MISMATCH');
        }
        
        // Check for partial match (if vendor SKU missing)
        const partialCheck = checkPartialMatch_(row, matchResult, invoicePrice);
        if (partialCheck.isPartial) {
          //return enrichRowWithMatch_(row, matchResult, 'PARTIAL_MATCH', null, partialCheck);
          return enrichRowWithMatch_(row, matchResult, 'PARTIAL_MATCH', null, partialCheck, checkMyId_(row, matchResult));

        }
        
        return enrichRowWithMatch_(row, matchResult, 'MATCH');
      }
    }
    
    // Step 2: Try factory codes (in priority order)
    if (row.factory_code) {
      const factoryCodes = row.factory_code.split('|');
      
      for (const code of factoryCodes) {
        const match = matchSKUByFactoryCode_(code, productMaster);
        if (match) {
          matchedProducts.push(match);
        }
      }
      
      if (matchedProducts.length === 1) {
        matchResult = matchedProducts[0];
        
        if (vendorSKU && matchResult.sku !== vendorSKU) {
          return enrichRowWithMatch_(row, matchResult, 'SKU_MISMATCH');
        }
        
        const partialCheck = checkPartialMatch_(row, matchResult, invoicePrice);
        if (partialCheck.isPartial) {
          return enrichRowWithMatch_(row, matchResult, 'PARTIAL_MATCH', null, partialCheck);
        }
        
        return enrichRowWithMatch_(row, matchResult, 'MATCH');
        
      } else if (matchedProducts.length > 1) {
        const uniqueSKUs = [...new Set(matchedProducts.map(p => p.sku))];
        
        if (uniqueSKUs.length === 1) {
          matchResult = matchedProducts[0];
          
          if (vendorSKU && matchResult.sku !== vendorSKU) {
            return enrichRowWithMatch_(row, matchResult, 'SKU_MISMATCH');
          }
          
          const partialCheck = checkPartialMatch_(row, matchResult, invoicePrice);
          if (partialCheck.isPartial) {
            return enrichRowWithMatch_(row, matchResult, 'PARTIAL_MATCH', null, partialCheck);
          }
          
          return enrichRowWithMatch_(row, matchResult, 'MATCH');
        } else {
          return enrichRowWithMatch_(row, matchedProducts[0], 'MULTIPLE_MATCH', matchedProducts);
        }
      }
    }
    
    return enrichRowWithMatch_(row, null, 'UNMATCHED');
  });
} */

/**
 * Enrich row with matching results
 * UPDATED: Added partialMatchInfo parameter for PARTIAL_MATCH cases
 */
/*function enrichRowWithMatch_(row, matchResult, matchStatus, allMatches = null, partialMatchInfo = null) {
  const enriched = {
    // Preserve ALL incoming fields first
    ...row,
    
    // Match fields added on top
    match_status: matchStatus,
    matched_sku: matchResult ? matchResult.sku : '',
    matched_name: matchResult ? matchResult.productName : '',
    matched_by: matchResult ? matchResult.matchedBy : '',
    matched_code: matchResult ? matchResult.matchedCode : '',
    match_confidence: matchResult ? matchResult.matchConfidence : '',
    vendor_provided_sku: row.sku || row.factory_code || '',
    sku_mismatch_flag: matchStatus === 'SKU_MISMATCH',
    master_cost: matchResult ? matchResult.cost : 0
  };
  
  if (matchStatus === 'PARTIAL_MATCH' && partialMatchInfo) {
    enriched.partial_match_reason = partialMatchInfo.reason;
    enriched.name_similarity = partialMatchInfo.nameSimilarity;
    enriched.price_diff_percentage = partialMatchInfo.priceDiff;
  }
  
  if (matchStatus === 'MULTIPLE_MATCH' && allMatches) {
    enriched.multiple_matches = allMatches.map(m => ({
      sku: m.sku,
      name: m.productName,
      matchedBy: m.matchedBy,
      matchedCode: m.matchedCode,
      cost: m.cost
    }));
  }
  
  return enriched;
} */

/**
 * Helper function to get sheet by name
 * Add error handling
 */
function getSheet_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  return sheet;
}

/**
 * API: Get Product Master List for Manual Selection
 * Returns simplified list of products for dropdown
 */
function apiGetProductMasterList() {
  try {
    const products = loadEEProductMaster_();
    
    // Return simplified list with only necessary fields
    const simplifiedList = products.map(p => ({
      sku: p.sku,
      productName: p.productName,
      cost: p.cost,
      ean: p.ean,
      articleNumber: p.articleNumber,
      otherFactoryCode: p.otherFactoryCode
    }));
    
    return {
      status: 'success',
      products: simplifiedList,
      count: simplifiedList.length
    };
  } catch (error) {
    return {
      status: 'error',
      message: error.message || 'Failed to load product master',
      products: []
    };
  }
}


//---------------------------------API: Allocate shipment to open POs using FIFO -----------------------------



/**
 * API: Allocate shipment to open POs using FIFO
 */
function apiAllocateToOpenPOs(payload) {
  const { vendor_code, validated_rows } = payload;
  
  if (!vendor_code) throw new Error("vendor_code is required");
  if (!Array.isArray(validated_rows) || validated_rows.length === 0) {
    throw new Error("validated_rows is required");
  }
  
  // Get open POs for this vendor
  const openPOs = getOpenPOsForVendor_(vendor_code);
  
  const allocations = [];
  const now = new Date();
  
  // Process each SKU from shipment
  validated_rows.forEach(row => {
    //const sku = row.matched_sku || row.sku;
    const sku = row.resolution_action === 'REQUEST_NEW_SKU' ? '' : (row.matched_sku || row.sku);
    if (!sku) return; // Skip rows without SKU
    
    const allocation = {
      sku: sku,
      sku_name: row.matched_name || row.item_name,
      invoice_qty: Number(row.invoice_qty || 0),
      unit_price: Number(row.unit_price || row.invoice_unit_price_rmb || 0),
      po_allocations: [],
      total_allocated: 0,
      unallocated_qty: 0
    };
    
    let remainingQty = allocation.invoice_qty;
    
    // Find POs that have this SKU with pending qty
    openPOs.forEach(po => {
      if (remainingQty <= 0) return;
      
      // Find line in this PO for this SKU
      const poLine = po.lines.find(line => 
        String(line.sku).trim() === String(sku).trim()
      );
      
      if (!poLine) return;
      
      const orderedQty = Number(poLine.ordered_qty || 0);
      const fulfilledQty = Number(poLine.fulfilled_qty || 0);
      const pendingQty = orderedQty - fulfilledQty;
      
      if (pendingQty <= 0) return;
      
      // Allocate as much as possible to this PO
      const allocateQty = Math.min(remainingQty, pendingQty);
      
      // Calculate age
      const poDate = new Date(po.po_date);
      const ageDays = Math.floor((now - poDate) / (1000 * 60 * 60 * 24));
      
      allocation.po_allocations.push({
        po_id: po.po_id,
        po_date: po.po_date,
        age_days: ageDays,
        ordered_qty: orderedQty,
        fulfilled_qty: fulfilledQty,
        pending_qty: pendingQty,
        allocated_qty: allocateQty,
        will_be_fulfilled: (fulfilledQty + allocateQty) >= orderedQty
      });
      
      allocation.total_allocated += allocateQty;
      remainingQty -= allocateQty;
    });
    
    allocation.unallocated_qty = remainingQty;
    allocations.push(allocation);
  });
  
  // Calculate summary
  const summary = {
    total_skus: allocations.length,
    total_invoice_qty: allocations.reduce((sum, a) => sum + a.invoice_qty, 0),
    total_allocated: allocations.reduce((sum, a) => sum + a.total_allocated, 0),
    total_unallocated: allocations.reduce((sum, a) => sum + a.unallocated_qty, 0),
    pos_involved: [...new Set(allocations.flatMap(a => a.po_allocations.map(p => p.po_id)))]
  };
  
  return {
    status: 'success',
    allocations: allocations,
    summary: summary
  };
}

/**
 * Helper: Get open POs for vendor (FIFO sorted)
 */
function getOpenPOsForVendor_(vendorCode) {
  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  const poData = poSheet.getDataRange().getValues();
  
  const poLineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const poLineHeader = getHeaderMap_(poLineSheet);
  const poLineData = poLineSheet.getDataRange().getValues();
  
  const openPOs = [];
  
  // Get open POs for this vendor
  for (let i = 1; i < poData.length; i++) {
    const row = poData[i];
    const poVendor = String(row[poHeader.vendor_code] || '').trim();
    const poStatus = String(row[poHeader.po_status] || '').trim();
    
    if (poVendor !== vendorCode) continue;
    if (poStatus !== 'OPEN' && poStatus !== 'PARTIALLY_SHIPPED') continue;
    
    const po = {
      po_id: row[poHeader.po_id],
      po_date: row[poHeader.po_date],
      vendor_code: poVendor,
      po_status: poStatus,
      lines: []
    };
    
    // Get lines for this PO
    for (let j = 1; j < poLineData.length; j++) {
      const lineRow = poLineData[j];
      if (String(lineRow[poLineHeader.po_id]).trim() !== po.po_id) continue;
      
      po.lines.push({
        sku: lineRow[poLineHeader.sku],
        sku_name: lineRow[poLineHeader.sku_name],
        ordered_qty: lineRow[poLineHeader.ordered_qty],
        fulfilled_qty: lineRow[poLineHeader.fulfilled_qty] || 0
      });
    }
    
    openPOs.push(po);
  }
  
  // Sort by PO date ASC (FIFO - oldest first)
  openPOs.sort((a, b) => {
    const dateA = new Date(a.po_date).getTime();
    const dateB = new Date(b.po_date).getTime();
    return dateA - dateB;
  });
  
  return openPOs;
}

//------------------- API: Get Review Data with reconciliation and warnings-----------------------------


function apiGetReviewData(payload) {
  const { vendor_code, validated_rows, allocations } = payload;
  
  if (!validated_rows || !allocations) {
    throw new Error("validated_rows and allocations are required");
  }
  
  // 1. Calculate Financial Reconciliation
  const reconciliation = calculateFinancialReconciliation_(validated_rows, allocations);
  
  // 2. Detect Warnings
  const warnings = detectWarnings_(validated_rows, allocations);
  
  // 3. Calculate Summary Stats
  const summary = {
    vendor_code: vendor_code,
    total_skus: allocations.length,
    total_invoice_qty: allocations.reduce((sum, a) => sum + Number(a.invoice_qty || 0), 0),
    total_allocated: allocations.reduce((sum, a) => sum + Number(a.total_allocated || 0), 0),
    total_unallocated: allocations.reduce((sum, a) => sum + Number(a.unallocated_qty || 0), 0),
    
    // PO statistics
    pos_fully_fulfilled: countFullyFulfilledPOs_(allocations),
    pos_partially_fulfilled: countPartiallyFulfilledPOs_(allocations),
    unique_pos_involved: getUniquePOs_(allocations)
  };
  
  // 4. Check if can proceed (no blocking warnings)
  const canProceed = !warnings.some(w => w.severity === 'BLOCKING');
  
  return {
    status: 'success',
    summary: summary,
    reconciliation: reconciliation,
    warnings: warnings,
    can_proceed: canProceed
  };
}

/**
 * Calculate financial reconciliation.
 *
 * This is a genuine price-variance check, independent of allocation coverage:
 *   Invoice Value      = sum(invoice_qty * vendor's invoice unit price) across the full shipment
 *   Our Recorded Value = sum(invoice_qty * our recorded RMB price) across the full shipment
 *
 * "Our recorded RMB price" is sourced from the actual Purchase Order lines this shipment is
 * being allocated against — i.e. the price we committed to when each PO was raised — accumulated
 * (weighted) across every PO a SKU's allocated quantity was drawn from, since a SKU can be
 * fulfilled from multiple POs raised at different prices over time. Any portion of a line that
 * has no PO allocation yet falls back to the current EE Product Master cost, since there's no
 * PO-committed price to reference for that remainder.
 *
 * Rejected / REQUEST_NEW_SKU lines are excluded — they're not part of the shipment being created.
 */
function calculateFinancialReconciliation_(validatedRows, allocations) {
  const relevantRows = validatedRows.filter(row =>
    row.resolution_action !== 'REJECT_LINE' &&
    row.resolution_action !== 'REQUEST_NEW_SKU'
  );

  // Build po_id|sku -> unit_price_rmb map from the actual PO lines
  const poLineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const poLineHeader = getHeaderMap_(poLineSheet);
  const poLineData = poLineSheet.getDataRange().getValues();
  const poPriceMap = {};
  for (let i = 1; i < poLineData.length; i++) {
    const poId = String(poLineData[i][poLineHeader.po_id] || '').trim();
    const sku  = String(poLineData[i][poLineHeader.sku] || '').trim();
    if (!poId || !sku) continue;
    poPriceMap[poId + '|' + sku] = Number(poLineData[i][poLineHeader.unit_price_rmb] || 0);
  }

  // Per-SKU: quantity + value actually recorded against a PO (accumulated across every
  // PO the allocation drew from), so multi-PO fulfillment is weighted correctly.
  const poRecordedBySku = {};
  (allocations || []).forEach(alloc => {
    const sku = alloc.sku;
    if (!sku || !Array.isArray(alloc.po_allocations)) return;
    let qty = 0, value = 0;
    alloc.po_allocations.forEach(pa => {
      const allocatedQty = Number(pa.allocated_qty || 0);
      if (allocatedQty <= 0) return;
      const poPrice = poPriceMap[pa.po_id + '|' + sku] || 0;
      qty += allocatedQty;
      value += allocatedQty * poPrice;
    });
    poRecordedBySku[sku] = { qty: qty, value: value };
  });

  let invoiceTotal = 0;
  let recordedTotal = 0;
  const itemVariances = [];

  relevantRows.forEach(row => {
    const qty = Number(row.invoice_qty || 0);
    const invoicePrice = Number(row.unit_price || row.invoice_unit_price_rmb || 0);
    const sku = row.matched_sku || row.sku || '';
    const masterPrice = Number(row.master_cost || 0);

    // Recorded value for this line: PO-committed price for the allocated portion,
    // current master cost for whatever hasn't been allocated to a PO yet.
    const poRecorded = poRecordedBySku[sku];
    let recordedValue, recordedPrice;
    if (poRecorded && poRecorded.qty > 0) {
      const unallocQty = Math.max(qty - poRecorded.qty, 0);
      recordedValue = poRecorded.value + (unallocQty * masterPrice);
      recordedPrice = qty > 0 ? recordedValue / qty : 0;
    } else {
      recordedValue = qty * masterPrice;
      recordedPrice = masterPrice;
    }

    invoiceTotal += qty * invoicePrice;
    recordedTotal += recordedValue;

    if (recordedPrice > 0 && invoicePrice > 0) {
      const linePct = ((invoicePrice - recordedPrice) / recordedPrice) * 100;
      if (Math.abs(linePct) > 1) {
        itemVariances.push({
          sku: sku,
          item_name: row.matched_name || row.item_name || '',
          qty: qty,
          invoice_price: Math.round(invoicePrice * 100) / 100,
          recorded_price: Math.round(recordedPrice * 100) / 100,
          line_diff: Math.round((qty * invoicePrice - recordedValue) * 100) / 100,
          percentage_diff: Math.round(linePct * 100) / 100
        });
      }
    }
  });

  // Worst offenders first
  itemVariances.sort((a, b) => Math.abs(b.percentage_diff) - Math.abs(a.percentage_diff));

  const difference = invoiceTotal - recordedTotal;
  const percentageDiff = recordedTotal !== 0 ? (difference / recordedTotal) * 100 : 0;

  return {
    invoice_total: Math.round(invoiceTotal * 100) / 100,
    recorded_total: Math.round(recordedTotal * 100) / 100,
    difference: Math.round(difference * 100) / 100,
    percentage_diff: Math.round(percentageDiff * 100) / 100,
    has_variance: Math.abs(percentageDiff) > 0.5, // 0.5% tolerance
    item_variances: itemVariances
  };
}

/**
 * Detect warnings and issues
 */
function detectWarnings_(validatedRows, allocations) {
  const warnings = [];
  
  // 1. Price Variance Warnings (from validation)
  const priceVariances = validatedRows.filter(row => {
    if (row.price_check_status === 'FAIL' && row.price_diff_percentage) {
      return Math.abs(Number(row.price_diff_percentage)) > 10;
    }
    return false;
  });
  
  if (priceVariances.length > 0) {
    warnings.push({
      type: 'PRICE_VARIANCE',
      severity: 'WARNING',
      count: priceVariances.length,
      message: priceVariances.length + ' items with price variance > 10%',
      items: priceVariances.map(r => ({
        sku: r.matched_sku || r.sku,
        item_name: r.matched_name || r.item_name,
        variance_percentage: r.price_diff_percentage
      }))
    });
  }
  
  // 2. Unallocated SKUs
  const unallocatedItems = allocations.filter(a => Number(a.unallocated_qty || 0) > 0);
  
  if (unallocatedItems.length > 0) {
    const totalUnallocatedQty = unallocatedItems.reduce((sum, a) => 
      sum + Number(a.unallocated_qty || 0), 0
    );
    
    warnings.push({
      type: 'UNALLOCATED',
      severity: 'WARNING',
      count: unallocatedItems.length,
      message: unallocatedItems.length + ' SKUs have unallocated quantities (' + totalUnallocatedQty + ' units)',
      items: unallocatedItems.map(a => ({
        sku: a.sku,
        item_name: a.sku_name,
        unallocated_qty: a.unallocated_qty,
        invoice_qty: a.invoice_qty
      }))
    });
  }
  
  // 3. Flagged Items (BLOCKING)
  const flaggedItems = validatedRows.filter(row => 
    row.resolution_action === 'FLAG_REVIEW'
  );
  
  if (flaggedItems.length > 0) {
    warnings.push({
      type: 'FLAGGED_ITEMS',
      severity: 'BLOCKING',
      count: flaggedItems.length,
      message: flaggedItems.length + ' items flagged for review (must be resolved)',
      items: flaggedItems.map(r => ({
        sku: r.matched_sku || r.sku,
        item_name: r.matched_name || r.item_name,
        match_status: r.match_status,
        resolution_notes: r.resolution_notes
      }))
    });
  }
  
  // 4. Items without PO at all (no allocation possible)
  const noPOItems = allocations.filter(a => 
    a.po_allocations.length === 0 && Number(a.unallocated_qty || 0) > 0
  );
  
  if (noPOItems.length > 0) {
    warnings.push({
      type: 'NO_PO',
      severity: 'WARNING',
      count: noPOItems.length,
      message: noPOItems.length + ' SKUs have no open purchase orders',
      items: noPOItems.map(a => ({
        sku: a.sku,
        item_name: a.sku_name,
        qty: a.invoice_qty
      }))
    });
  }
  
  return warnings;
}

/**
 * Helper: Count fully fulfilled POs
 */
function countFullyFulfilledPOs_(allocations) {
  const fulfilledPOs = new Set();
  
  allocations.forEach(alloc => {
    if (alloc.po_allocations) {
      alloc.po_allocations.forEach(po => {
        if (po.will_be_fulfilled === true) {
          fulfilledPOs.add(po.po_id);
        }
      });
    }
  });
  
  return fulfilledPOs.size;
}

/**
 * Helper: Count partially fulfilled POs
 */
function countPartiallyFulfilledPOs_(allocations) {
  const partialPOs = new Set();
  
  allocations.forEach(alloc => {
    if (alloc.po_allocations) {
      alloc.po_allocations.forEach(po => {
        if (po.will_be_fulfilled === false && Number(po.allocated_qty || 0) > 0) {
          partialPOs.add(po.po_id);
        }
      });
    }
  });
  
  return partialPOs.size;
}

/**
 * Helper: Get unique PO list
 */
function getUniquePOs_(allocations) {
  const allPOs = [];
  
  allocations.forEach(alloc => {
    if (alloc.po_allocations) {
      alloc.po_allocations.forEach(po => {
        allPOs.push(po.po_id);
      });
    }
  });
  
  return [...new Set(allPOs)];
}




/////---------------------------------Shipment Creation + Batch Creation------------------
/**
 * Generate next Batch ID with separate sequences for Sea/Air
 */
function generateBatchId_(batchType) {
  const sheet = getSheet_(SHEET_NAMES.BATCHES);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  
  const year = String(new Date().getFullYear()).slice(-2); // "26"
  const prefix = batchType === 'AIR' ? 'A' : 'S';
  // Format: A-26001, A-26002 — prefix is "A-26"
  const batchPrefix = `${prefix}-${year}`;
  
  let maxSeq = 0;
  
  for (let i = 1; i < data.length; i++) {
    const batchId = String(data[i][header.batch_id] || '').trim();
    if (batchId.startsWith(batchPrefix)) {
      // "A-26001" → remove "A-26" → "001" → parseInt = 1
      const seqStr = batchId.slice(batchPrefix.length);
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq)) {
        maxSeq = Math.max(maxSeq, seq);
      }
    }
  }
  
  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${batchPrefix}${nextSeq}`; // A-26001, A-26002, A-26003...
}

/**
 * Create new batch record
 */
function apiCreateBatch_(batchType, createdBy) {
  const batchId = generateBatchId_(batchType);
  const now = new Date();
  
  const sheet = getSheet_(SHEET_NAMES.BATCHES);
  const header = getHeaderMap_(sheet);
  
  // Guard — if batch ID already exists, return it without creating a duplicate
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][header.batch_id]).trim() === batchId) {
      Logger.log('Batch already exists, skipping creation: ' + batchId);
      return batchId;
    }
  }
  
  appendRowFromObject_(sheet, header, {
    batch_id: batchId,
    batch_type: batchType,
    status: 'OPEN',
    total_shipments: 0,
    total_vendors: 0,
    total_cartons: 0,
    total_amount: 0,
    total_currency: 'RMB',
    created_at: now,
    created_by: createdBy,
    shipped_at: '',
    expected_delivery: '',
    actual_delivery: '',
    tracking_number: '',
    carrier: '',
    notes: ''
  });
  
  return batchId;
}
/**
 * Get open batches (not delivered yet)
 */
function apiGetOpenBatches(payload) {
  const { batch_type } = payload; // Optional filter by SEA/AIR
  
  const sheet = getSheet_(SHEET_NAMES.BATCHES);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  
  const batches = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = String(row[header.status] || '').toUpperCase();
    const type = String(row[header.batch_type] || '').toUpperCase();
    
    // Filter: status not DELIVERED or CLOSED
    if (status === 'DELIVERED' || status === 'CLOSED') continue;
    
    // Optional: filter by batch_type
    if (batch_type && type !== batch_type.toUpperCase()) continue;
    
    batches.push({
      batch_id: row[header.batch_id],
      batch_type: type,
      status: status,
      total_shipments: row[header.total_shipments] || 0,
      total_cartons: row[header.total_cartons] || 0,
      total_amount: row[header.total_amount] || 0,
      // Batch-level attributes shared by every shipment riding in this batch,
      // so a new shipment joining an existing batch can default to them
      // instead of the user retyping the same carrier/date every time.
      carrier: row[header.carrier] || '',
      expected_delivery: row[header.expected_delivery] || null,
      created_at: row[header.created_at]
    });
  }
  
  return {
    status: 'success',
    batches: batches
  };
}

/**
 * Update batch totals after adding shipment
 */
function updateBatchTotals_(batchId, cartonCount, amount, vendorCode, carrier, expectedDelivery) {
  const sheet = getSheet_(SHEET_NAMES.BATCHES);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][header.batch_id]).trim() === batchId) {
      const currentShipments = Number(data[i][header.total_shipments] || 0);
      const currentCartons = Number(data[i][header.total_cartons] || 0);
      const currentAmount = Number(data[i][header.total_amount] || 0);
      
      // Recalculate unique vendors properly from Vendor_Shipments sheet
      const shipmentSheet2 = getSheet_(SHEET_NAMES.VENDOR_SHIPMENTS);
      const shipmentHeader2 = getHeaderMap_(shipmentSheet2);
      const shipmentData2 = shipmentSheet2.getDataRange().getValues();
      const vendorsInBatch = new Set();
      for (let j = 1; j < shipmentData2.length; j++) {
        if (String(shipmentData2[j][shipmentHeader2.batch_id] || '').trim() === batchId) {
          vendorsInBatch.add(String(shipmentData2[j][shipmentHeader2.vendor_code] || '').trim());
        }
      }
      vendorsInBatch.add(vendorCode); // Include current shipment's vendor

      // Carrier/ETA: fill in only if the batch doesn't already have one set.
      // This used to overwrite unconditionally on every shipment added to
      // the batch — fine for the first shipment, but it clobbered a
      // carrier/ETA an admin had already set on an OPEN batch (or one set by
      // an earlier shipment) with this new shipment's own value, including
      // blanking it out if this shipment didn't specify one.
      const existingCarrier = String(data[i][header.carrier] || '').trim();
      const existingExpectedDelivery = data[i][header.expected_delivery];
      const updates = {
        total_shipments: currentShipments + 1,
        total_cartons: currentCartons + cartonCount,
        total_amount: currentAmount + amount,
        total_vendors: vendorsInBatch.size,
        total_currency: 'RMB'
      };
      if (!existingCarrier && carrier) updates.carrier = carrier;
      if (!existingExpectedDelivery && expectedDelivery) updates.expected_delivery = new Date(expectedDelivery);

      updateRowByKey_(sheet, header, 'batch_id', batchId, updates);

      return true;
    }
  }
  
  return false;
}

/**
 * Generate shipment ID
 */
function generateShipmentId_(vendorCode, date) {
  const sheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENTS);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  
  const dateKey = `${yy}${mm}${dd}`;
  const prefix = `VS-${vendorCode}${dateKey}-`;
  
  let maxSeq = 0;
  
  for (let i = 1; i < data.length; i++) {
    const shipmentId = String(data[i][header.shipment_id] || '');
    if (shipmentId.startsWith(prefix)) {
      const parts = shipmentId.split('-');
      const seq = Number(parts[parts.length - 1]);
      if (!isNaN(seq)) {
        maxSeq = Math.max(maxSeq, seq);
      }
    }
  }
  
  return `${prefix}${maxSeq + 1}`;
}

/**
 * Update PO line fulfillment
 */
function updatePOLineFulfillment_(poId, sku, allocatedQty) {
  const sheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[header.po_id]).trim() === poId && 
        String(row[header.sku]).trim() === sku) {
      
      const currentFulfilled = Number(row[header.fulfilled_qty] || 0);
      const orderedQty = Number(row[header.ordered_qty] || 0);
      const newFulfilled = currentFulfilled + allocatedQty;
      
      // Determine line status
      let lineStatus = 'OPEN';
      if (newFulfilled >= orderedQty) {
        lineStatus = 'FULFILLED';
      } else if (newFulfilled > 0) {
        lineStatus = 'PARTIAL';
      }
      
      // Update the row
      data[i][header.fulfilled_qty] = newFulfilled;
      data[i][header.line_status] = lineStatus;
      data[i][header.updated_at] = new Date();
      
      sheet.getRange(i + 1, 1, 1, data[0].length).setValues([data[i]]);
      return true;
    }
  }
  
  return false;
}

/**
 * Update PO status based on all lines
 */
function updatePOStatus_(poId) {
  const lineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();
  
  let allFulfilled = true;
  let anyFulfilled = false;
  
  // Check all lines for this PO
  for (let i = 1; i < lineData.length; i++) {
    if (String(lineData[i][lineHeader.po_id]).trim() === poId) {
      const orderedQty = Number(lineData[i][lineHeader.ordered_qty] || 0);
      const fulfilledQty = Number(lineData[i][lineHeader.fulfilled_qty] || 0);
      
      if (fulfilledQty < orderedQty) {
        allFulfilled = false;
      }
      if (fulfilledQty > 0) {
        anyFulfilled = true;
      }
    }
  }
  
  // Determine PO status
  let poStatus = 'OPEN';
  if (allFulfilled) {
    poStatus = 'CLOSED';
  } else if (anyFulfilled) {
    poStatus = 'PARTIALLY_SHIPPED';
  }
  
  // Update PO
  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  
  updateRowByKey_(poSheet, poHeader, 'po_id', poId, {
    po_status: poStatus,
    updated_at: new Date()
  });
}

// Scans Vendor_Shipments for a row already stamped with this idempotency_key
// — see the durable-idempotency comment in apiCreateVendorShipment for why
// this exists alongside the CacheService check. `shipmentHeader` must already
// include 'idempotency_key' (ensureHeaderColumn_ run by the caller first).
function findVendorShipmentByIdempotencyKey_(shipmentSheet, shipmentHeader, key) {
  var keyCol = shipmentHeader['idempotency_key'];
  if (keyCol === undefined) return null;
  var idCol = shipmentHeader['shipment_id'];
  var createdCol = shipmentHeader['created_at'];
  var data = shipmentSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][keyCol] || '').trim() === key) {
      return { shipment_id: data[i][idCol], created_at: data[i][createdCol] };
    }
  }
  return null;
}

/**
 * API: Create Vendor Shipment
 */
function apiCreateVendorShipment(payload) {
  const {
    vendor_code,
    shipment_date,
    batch_option,
    batch_id,
    batch_type,
    carton_count,
    total_amount,
    notes,
    invoice_no,
    invoice_date,
    carrier,
    expected_delivery,
    validated_rows,
    allocations,
    idempotency_key
  } = payload;

  // Validations
  if (!vendor_code) throw new Error("Vendor code is required");
  if (!shipment_date) throw new Error("Shipment date is required");
  if (!batch_option) throw new Error("Batch option is required");
  if (batch_option === 'existing' && !batch_id) {
    throw new Error("Please select a batch");
  }
  if (batch_option === 'new' && !batch_type) {
    throw new Error("Batch type is required for new batch");
  }
  if (!carton_count || carton_count <= 0) {
    throw new Error("Carton count must be greater than 0");
  }
  if (!total_amount || total_amount <= 0) {
    throw new Error("Total amount must be greater than 0");
  }

  // Idempotency guard — a network drop, an EasyEcom push slow enough to
  // outlast the browser's patience, or a stray double-click must not create
  // a second batch/shipment/PO/EasyEcom-PO. The frontend resends the same
  // key on any retry of the same finalize attempt.
  var idemCacheKey = idempotency_key ? ('vshp_idem_' + idempotency_key) : null;
  if (idemCacheKey) {
    var idemCache = CacheService.getScriptCache();
    var idemLock = LockService.getScriptLock();
    idemLock.waitLock(30000);
    try {
      var idemCached = idemCache.get(idemCacheKey);
      if (idemCached) return JSON.parse(idemCached);
      // Claim the key immediately so a concurrent retry that was waiting on
      // this lock sees a short-lived "in progress" marker instead of racing
      // this request to create a duplicate; overwritten with the real result below.
      idemCache.put(idemCacheKey, JSON.stringify({ status: 'error', message: 'This shipment is already being created — please wait a moment and check Shipment Tracker before retrying.' }), 60);
    } finally {
      idemLock.releaseLock();
    }
  }

  const now = new Date();
  const userEmail = Session.getActiveUser().getEmail();

  // Get sheets
  const shipmentSheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENTS);
  // Self-creating column (same pattern as has_logo/has_packaging on
  // Vendor_Shipment_Lines) — must run before getHeaderMap_ so the new
  // column is actually in the map appendRowFromObject_ writes against.
  ensureHeaderColumn_(shipmentSheet, 'idempotency_key');
  const shipmentHeader = getHeaderMap_(shipmentSheet);

  // Durable idempotency guard — the CacheService check above only covers a
  // retry within its own short window (60s "in progress" marker, or the 6h
  // success-result cache written at the very end of this function). If this
  // function throws partway through a PARTIAL commit (header row written,
  // then a later step — lines, PO fulfillment, batch totals, EasyEcom push —
  // fails), neither cache entry reflects that: the "in progress" marker just
  // expires after 60s with nothing to show for it. A user who retries minutes
  // later (the realistic case — they see an error, wait, click again) would
  // sail straight through the CacheService check above and re-run this whole
  // function from scratch, creating a second shipment/batch-total-increment/
  // PO-fulfillment/EasyEcom-push for the same real shipment — the exact
  // "double entry" bug this guard exists to close. Stamping the key onto the
  // row itself (never expires, survives across executions) lets a retry find
  // that a prior attempt already got this far. Returning a clear error here
  // instead of a fabricated "success" is deliberate: we genuinely don't know
  // whether the prior attempt finished (lines/PO fulfillment/batch totals
  // may or may not have run), so silently reporting success could hide an
  // incomplete shipment. Surfacing it tells the user exactly what to check
  // instead of letting them believe nothing happened.
  if (idempotency_key) {
    var existingShip_ = findVendorShipmentByIdempotencyKey_(shipmentSheet, shipmentHeader, idempotency_key);
    if (existingShip_) {
      throw new Error(
        'A shipment for this exact submission already exists (ID: ' + existingShip_.shipment_id +
        ', created ' + Utilities.formatDate(new Date(existingShip_.created_at), Session.getScriptTimeZone(), 'dd-MMM HH:mm') +
        '). Please check Shipment Tracker before retrying — do not resubmit. If it looks incomplete, contact an admin instead of clicking Finalize again.'
      );
    }
  }

  // Create or use batch
  let finalBatchId = batch_id;
  if (batch_option === 'new') {
    finalBatchId = apiCreateBatch_(batch_type, userEmail);
  }

  // Generate shipment ID
  const shipmentId = generateShipmentId_(vendor_code, new Date(shipment_date));

  const lineSheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENT_LINES);
  const lineHeader = getHeaderMap_(lineSheet);

  // Create shipment header
  appendRowFromObject_(shipmentSheet, shipmentHeader, {
    shipment_id: shipmentId,
    batch_id: finalBatchId,
    vendor_code: vendor_code,
    po_id: '',
    status: 'SHIPPED',
    idempotency_key: idempotency_key || '',
    invoice_no: invoice_no || '',
    invoice_date: invoice_date ? new Date(invoice_date) : '',
    total_amount: total_amount,
    carton_count: carton_count,
    carrier: carrier || '',
    expected_delivery: expected_delivery ? new Date(expected_delivery) : '',
    remarks: notes || '',
    created_at: now,
    submitted_at: now
  });

// FIX B — Delete orphaned DRAFT/NORMALIZED rows
// Re-read sheet fresh after appending the SHIPPED row
const freshShipData = shipmentSheet.getDataRange().getValues();
const freshHeaders = freshShipData[0];
const sidColIdx = freshHeaders.indexOf('shipment_id');
const statusColIdx = freshHeaders.indexOf('status');
const vendorColIdx = freshHeaders.indexOf('vendor_code');

// Iterate bottom-up so deletions don't shift indices
for (let i = freshShipData.length - 1; i >= 1; i--) {
  const rowShipmentId = String(freshShipData[i][sidColIdx] || '').trim();
  const rowStatus = String(freshShipData[i][statusColIdx] || '').trim();
  const rowVendor = String(freshShipData[i][vendorColIdx] || '').trim();

  if (
    rowVendor === vendor_code &&
    rowStatus === 'NORMALIZED' &&
    rowShipmentId !== shipmentId
  ) {
    shipmentSheet.deleteRow(i + 1);
  }
}

  // Create shipment lines from validated_rows (ALL items including unallocated)
  // validated_rows.forEach(row => {
  //   const unitPrice = Number(row.unit_price_total || row.unit_price || 0);
  //   const qty = Number(row.invoice_qty || 0);

  //   appendRowFromObject_(lineSheet, lineHeader, {
  //     shipment_id: shipmentId,
  //     batch_id: finalBatchId,
  //     line_id: Utilities.getUuid(),
  //     sku: row.matched_sku || row.sku,
  //     item_name: row.matched_name || row.item_name,
  //     factory_code: row.factory_code || '',
  //     ean: row.ean || '',
  //     invoice_qty: qty,

  //     // PRIMARY — always used by rest of system
  //     unit_price: unitPrice,
  //     total_price: qty * unitPrice,

  //     // BREAKDOWN — supplementary, 0 if not bifurcated
  //     unit_price_base: Number(row.unit_price_base || unitPrice),
  //     unit_price_box: Number(row.unit_price_box || 0),
  //     unit_price_blister: Number(row.unit_price_blister || 0),
  //     unit_price_manual: Number(row.unit_price_manual || 0),
  //     unit_price_total: unitPrice,

  //     validation_status: row.match_status || '',
  //     validation_notes: row.resolution_notes || ''
  //   });
  // });

  // Build a SKU → po_ids map from allocations
  const skuPoMap = {};
  if (allocations && Array.isArray(allocations)) {
  allocations.forEach(alloc => {
    if (alloc.sku && alloc.po_allocations && alloc.po_allocations.length > 0) {
      const poIds = alloc.po_allocations
        .filter(pa => pa.allocated_qty > 0)
        .map(pa => pa.po_id)
        .filter(Boolean);
      if (poIds.length > 0) {
        skuPoMap[alloc.sku] = poIds.join(',');
      }
    }
  });
}

// Create shipment lines from validated_rows
validated_rows.forEach(row => {
  const unitPrice = Number(row.unit_price_total || row.unit_price || 0);
  const qty = Number(row.invoice_qty || 0);
  const sku = row.matched_sku || row.sku || '';

  // Look up allocated PO IDs for this SKU
  const allocatedPoIds = skuPoMap[sku] || '';

  appendRowFromObject_(lineSheet, lineHeader, {
    shipment_id: shipmentId,
    batch_id: finalBatchId,
    line_id: Utilities.getUuid(),
    sku: sku,
    po_id: allocatedPoIds,          // ← NEW — comma-separated PO IDs
    item_name: row.matched_name || row.item_name,
    factory_code: row.factory_code || '',
    ean: row.ean || '',
    invoice_qty: qty,
    unit_price: unitPrice,
    total_price: qty * unitPrice,
    unit_price_base: Number(row.unit_price_base || unitPrice),
    unit_price_box: Number(row.unit_price_box || 0),
    unit_price_blister: Number(row.unit_price_blister || 0),
    unit_price_manual: Number(row.unit_price_manual || 0),
    unit_price_total: unitPrice,
    validation_status: row.match_status || '',
    validation_notes: row.resolution_notes || ''
  });
});
  // Update PO fulfillment from allocations
  const affectedPOs = new Set();
  
  allocations.forEach(alloc => {
    if (alloc.po_allocations && alloc.po_allocations.length > 0) {
      alloc.po_allocations.forEach(po => {
        updatePOLineFulfillment_(po.po_id, alloc.sku, po.allocated_qty);
        affectedPOs.add(po.po_id);
      });
    }
  });
  
  // Update PO statuses
  affectedPOs.forEach(poId => {
    updatePOStatus_(poId);
    logAuditEvent_('PURCHASE_ORDER', 'ALLOCATE', poId, `Fulfilled from shipment ${shipmentId}`, 'SUCCESS', userEmail);
  });

   // Update batch totals
  updateBatchTotals_(finalBatchId, carton_count, total_amount, vendor_code, carrier, expected_delivery);

  // Push to EasyEcom as in-transit PO
  const eeResult = pushShipmentToEasyEcom_(shipmentId, vendor_code, expected_delivery, validated_rows, finalBatchId);
  Logger.log('EasyEcom push result: ' + JSON.stringify(eeResult));

  // Write any REQUEST_NEW_SKU rows to New_SKU_Requests sheet
  const skuReqResult = writeNewSKURequests_(shipmentId, vendor_code, validated_rows, userEmail);
  Logger.log('SKU requests written: ' + JSON.stringify(skuReqResult));

  // Register ID / Price / EAN master-update requests in SKU_Update_Requests
  // for admin review — this is now the ONLY path for these corrections.
  // The change is not applied to EasyEcom until an admin approves it in
  // Update SKU → Review Requests (apiResolveSkuUpdateRequest, 18_newskuapi.gs).
  // The old "LEGACY" block that pushed straight to EasyEcom here has been
  // removed — review-then-apply is the point of this flow.
  const fieldUpdateResult = writeFieldUpdateRequests_(shipmentId, vendor_code, validated_rows, userEmail);
  Logger.log('Field update requests written: ' + JSON.stringify(fieldUpdateResult));

  var createVendorShipmentResult = {
    status: 'success',
    shipment_id: shipmentId,
    batch_id: finalBatchId,
    updated_pos: Array.from(affectedPOs),
    ee_push: eeResult.success ? 'PUSHED' : 'FAILED',
    ee_po_id: eeResult.poId || '',
    ee_push_error: eeResult.success ? '' : (eeResult.message || ''),
    sku_requests_created: skuReqResult.count || 0,
    field_update_requests_created: fieldUpdateResult.count || 0,
    message: `Shipment ${shipmentId} created successfully`
  };
  if (idemCacheKey) {
    // 6h — CacheService's max TTL; a resend past that point is treated as new,
    // which is fine since no client keeps a finalize attempt open that long.
    CacheService.getScriptCache().put(idemCacheKey, JSON.stringify(createVendorShipmentResult), 21600);
  }
  return createVendorShipmentResult;
}



//----------------------------------Batch Code----------------------------------
// getBatches() is the single endpoint for the Shipment Tracker screen. It is
// logistics-only and unauthenticated-safe — no finance fields (payment
// status, amounts, payments) are computed or returned here at all; those
// live on the separate Batch Detail page (get_batch_details, still used by
// AccountsView's payment drill-down and the SKU search deep link) and, going
// forward, CNF Agent Accounting. Everything a batch row's accordion needs
// (its shipments, and each shipment's SKU lines) is embedded in this one
// response — the UI never makes a second call to expand a row.
function getBatches() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var batchesSheet = ss.getSheetByName('Batches');
    var shipmentsSheet = ss.getSheetByName('Vendor_Shipments');
    var linesSheet = ss.getSheetByName('Vendor_Shipment_Lines');

    var batchesData = batchesSheet.getDataRange().getValues();
    var shipmentsData = shipmentsSheet.getDataRange().getValues();
    var linesData = linesSheet.getDataRange().getValues();

    var batchHeaders = batchesData[0];
    var shipmentHeaders = shipmentsData[0];
    var lineHeaders = linesData[0];

    var batchIdCol = batchHeaders.indexOf('batch_id');
    var batchTypeCol = batchHeaders.indexOf('batch_type');
    var statusCol = batchHeaders.indexOf('status');
    var createdAtCol = batchHeaders.indexOf('created_at');
    var createdByCol = batchHeaders.indexOf('created_by');
    var shippedAtCol = batchHeaders.indexOf('shipped_at');
    var expectedDeliveryCol = batchHeaders.indexOf('expected_delivery');
    var actualDeliveryCol = batchHeaders.indexOf('actual_delivery');
    var trackingCol = batchHeaders.indexOf('tracking_number');
    var carrierCol = batchHeaders.indexOf('carrier');
    var notesCol = batchHeaders.indexOf('notes');

    var shipBatchIdCol = shipmentHeaders.indexOf('batch_id');
    var shipmentIdCol = shipmentHeaders.indexOf('shipment_id');
    var eePoStatusCol = shipmentHeaders.indexOf('ee_po_status');
    var eePoReferenceCol = shipmentHeaders.indexOf('ee_po_reference');
    var eePushErrorCol = shipmentHeaders.indexOf('ee_push_error');
    var vendorCodeCol = shipmentHeaders.indexOf('vendor_code');
    var cartonCountCol = shipmentHeaders.indexOf('carton_count');
    var invoiceNoCol = shipmentHeaders.indexOf('invoice_no');
    var invoiceDateCol = shipmentHeaders.indexOf('invoice_date');
    var shipCreatedAtCol = shipmentHeaders.indexOf('created_at');
    var driveFolderIdCol = shipmentHeaders.indexOf('drive_folder_id');
    var driveFolderUrlCol = shipmentHeaders.indexOf('drive_folder_url');

    var lineShipmentIdCol = lineHeaders.indexOf('shipment_id');
    var lineIdCol = lineHeaders.indexOf('line_id');
    var lineQtyCol = lineHeaders.indexOf('invoice_qty');
    var lineUnitPriceCol = lineHeaders.indexOf('unit_price');
    var lineSkuCol = lineHeaders.indexOf('sku');
    var lineItemNameCol = lineHeaders.indexOf('item_name');
    var lineFactoryCodeCol = lineHeaders.indexOf('factory_code');
    var lineEanCol = lineHeaders.indexOf('ean');
    // Logo/Pkg/Manual/OPP live here as real, independently-editable columns
    // (see apiUpdateShipmentLineFlag_) — default false when the column is
    // missing (indexOf -1, so the read below is simply undefined) or blank,
    // never derived from Purchase_Order_Lines the way the Batch Detail page
    // still does for its own callers.
    var lineHasLogoCol = lineHeaders.indexOf('has_logo');
    var lineHasPackagingCol = lineHeaders.indexOf('has_packaging');
    var lineHasManualCol = lineHeaders.indexOf('has_manual');
    var lineHasOppCol = lineHeaders.indexOf('has_opp_wrap');

    // Vendor name isn't stored on Vendor_Shipments — build a vendor_code →
    // vendor_name map in one pass over EE Product Master instead of the old
    // per-shipment linear scan (buildVendorShipmentsForBatch_'s approach,
    // O(shipments × product rows) — the main cost behind get_batch_details
    // being slow, now avoided here entirely).
    // EE Product Master itself is the whole product catalog (thousands of
    // rows) and a raw getDataRange().getValues() on it was measured at ~5s,
    // occasionally 25s+, elsewhere in this codebase — and it's too large for
    // getSheetData_'s CacheService cache to hold (95KB/key cap; see
    // Inventory_Valuation.js's comment on the same sheet), so that helper
    // wouldn't actually help here. What this function needs from it is tiny
    // though — a deduped vendor_code→vendor_name map, at most a few dozen
    // entries — so that small derived result is cached directly instead of
    // the sheet it's built from. Worst case (cache miss) costs the same full
    // read as before; every other call within the 5-min window skips it
    // entirely. Vendor names change rarely and are display-only here, so a
    // window of staleness is low-risk (nothing else on this response derives
    // from this map — vendor_code, used for filtering, always comes fresh
    // from Vendor_Shipments above).
    var vendorNameMapCacheKey_ = 'batches_vendor_name_map';
    var scriptCache_ = CacheService.getScriptCache();
    var vendorNameMap = null;
    var cachedVendorNameMap_ = scriptCache_.get(vendorNameMapCacheKey_);
    if (cachedVendorNameMap_) {
      try { vendorNameMap = JSON.parse(cachedVendorNameMap_); } catch (e) { vendorNameMap = null; }
    }
    if (!vendorNameMap) {
      var productSheet = ss.getSheetByName('EE Product Master');
      var productData = productSheet.getDataRange().getValues();
      var productHeaders = productData[0];
      var prodVendorCodeCol = productHeaders.indexOf('vendor_code');
      var prodVendorNameCol = productHeaders.indexOf('vendor_name');
      vendorNameMap = {};
      for (var vn = 1; vn < productData.length; vn++) {
        var vnCode = productData[vn][prodVendorCodeCol];
        if (vnCode && !vendorNameMap[vnCode]) {
          vendorNameMap[vnCode] = productData[vn][prodVendorNameCol] || vnCode;
        }
      }
      try { scriptCache_.put(vendorNameMapCacheKey_, JSON.stringify(vendorNameMap), 300); } catch (e) {}
    }

    // Known SKU_Config prefixes, longest first, so a longer specific prefix
    // is checked before a shorter one could coincidentally match — matches
    // the same sku.startsWith(prefix) rule apiGetNextAvailableSku uses.
    // Multiple categories can share one prefix (Shape Mod / Skewb both
    // '113') — that ambiguity is deliberately left to the frontend, which
    // already needs the full category→prefix map to build filter chips.
    // Built once here — this used to call getSkuPrefixMap_() (a fresh
    // SKU_Config read) once per category via .map(), ~29 calls per request.
    var skuPrefixMap_ = getSkuPrefixMap_();
    var skuPrefixList_ = Object.keys(skuPrefixMap_)
      .map(function(cat) { return skuPrefixMap_[cat].prefix; })
      .filter(function(p, idx, arr) { return p && arr.indexOf(p) === idx; })
      .sort(function(a, b) { return b.length - a.length; });
    function prefixForSku_(sku) {
      var s = String(sku || '');
      for (var p = 0; p < skuPrefixList_.length; p++) {
        if (s.indexOf(skuPrefixList_[p]) === 0) return skuPrefixList_[p];
      }
      return null;
    }

    // ── Single pass over Vendor_Shipment_Lines: units + RMB value + item-type
    // prefixes per shipment (for batch-level metrics), AND the full line_items
    // array per shipment (for the accordion) — one read, one loop. ──────────
    // unit_price on Vendor_Shipment_Lines is always the RMB sourcing cost
    // (see loadEEProductMaster_'s RMB_Price comment in PO+Shipment Codes.js /
    // NewSkuApi.js) regardless of a batch's total_currency — so this value
    // sum is inherently "RMB only" with no currency-conversion logic needed,
    // and a USD-denominated batch's line items still contribute here.
    var unitsPerShipment = {};
    var valuePerShipment = {};
    var prefixesPerShipment = {};
    var lineItemsPerShipment = {};
    for (var j = 1; j < linesData.length; j++) {
      var lineShipId = String(linesData[j][lineShipmentIdCol] || '').trim();
      if (lineShipId) {
        var lineQty = Number(linesData[j][lineQtyCol]) || 0;
        var lineUnitPrice = Number(linesData[j][lineUnitPriceCol]) || 0;
        unitsPerShipment[lineShipId] = (unitsPerShipment[lineShipId] || 0) + lineQty;
        valuePerShipment[lineShipId] = (valuePerShipment[lineShipId] || 0) + (lineQty * lineUnitPrice);

        var linePrefix = prefixForSku_(linesData[j][lineSkuCol]);
        if (linePrefix) {
          if (!prefixesPerShipment[lineShipId]) prefixesPerShipment[lineShipId] = {};
          prefixesPerShipment[lineShipId][linePrefix] = true;
        }

        if (!lineItemsPerShipment[lineShipId]) lineItemsPerShipment[lineShipId] = [];
        lineItemsPerShipment[lineShipId].push({
          line_id: lineIdCol >= 0 ? (linesData[j][lineIdCol] || '') : '',
          sku: String(linesData[j][lineSkuCol] || '').trim(),
          item_name: lineItemNameCol >= 0 ? (linesData[j][lineItemNameCol] || '') : '',
          factory_code: lineFactoryCodeCol >= 0 ? (linesData[j][lineFactoryCodeCol] || '') : '',
          ean: lineEanCol >= 0 ? (linesData[j][lineEanCol] || '') : '',
          incoming_qty: lineQty,
          current_stock: null,
          future_stock: null,
          has_logo: lineHasLogoCol >= 0 ? !!linesData[j][lineHasLogoCol] : false,
          has_packaging: lineHasPackagingCol >= 0 ? !!linesData[j][lineHasPackagingCol] : false,
          has_manual: lineHasManualCol >= 0 ? !!linesData[j][lineHasManualCol] : false,
          has_opp_wrap: lineHasOppCol >= 0 ? !!linesData[j][lineHasOppCol] : false
        });
      }
    }

    // ── This Week's New Shipments — vendor shipments created in the last 7 days ──
    var today0 = new Date();
    var weekAgo = new Date(today0.getTime() - 7 * 24 * 60 * 60 * 1000);
    var newShipmentsThisWeek = 0;
    if (shipCreatedAtCol >= 0) {
      for (var j = 1; j < shipmentsData.length; j++) {
        var sCreatedAt = shipmentsData[j][shipCreatedAtCol];
        if (sCreatedAt && new Date(sCreatedAt) >= weekAgo) newShipmentsThisWeek++;
      }
    }
    
    var batches = [];
    var today = new Date();

    for (var i = 1; i < batchesData.length; i++) {
      var batchId = batchesData[i][batchIdCol];
      if (!batchId) continue;

      // Find shipments for this batch
      var batchShipments = [];
      for (var j = 1; j < shipmentsData.length; j++) {
        if (shipmentsData[j][shipBatchIdCol] === batchId) {
          batchShipments.push(shipmentsData[j]);
        }
      }

      var totalShipments = batchShipments.length;

      var vendorSet = {};
      for (var k = 0; k < batchShipments.length; k++) {
        vendorSet[batchShipments[k][vendorCodeCol]] = true;
      }
      var totalVendors = Object.keys(vendorSet).length;

      var totalCartons = 0;
      for (var k = 0; k < batchShipments.length; k++) {
        totalCartons += Number(batchShipments[k][cartonCountCol]) || 0;
      }

      // Total units + RMB value + item-type prefixes for this batch
      var totalUnits = 0;
      var totalValueRmb = 0;
      var batchPrefixSet = {};
      for (var k = 0; k < batchShipments.length; k++) {
        var sid = String(batchShipments[k][shipmentIdCol] || '').trim();
        totalUnits += unitsPerShipment[sid] || 0;
        totalValueRmb += valuePerShipment[sid] || 0;
        if (prefixesPerShipment[sid]) {
          for (var px in prefixesPerShipment[sid]) batchPrefixSet[px] = true;
        }
      }

      // ── Build vendor_shipments with full nested line_items ─────────────
      // Also rolls up each shipment's EasyEcom PO push status so a failure
      // is visible on the main tracker table, not just inside a drilldown.
      var vendorShipments = [];
      var anyEeFailed = false, anyEePushed = false;
      var firstEeError = '';
      for (var k = 0; k < batchShipments.length; k++) {
        var shipId = String(batchShipments[k][shipmentIdCol] || '').trim();
        var invDate = batchShipments[k][invoiceDateCol];
        var shipVendorCode = batchShipments[k][vendorCodeCol] || '';
        vendorShipments.push({
          shipment_id: shipId,
          vendor_code: shipVendorCode,
          vendor_name: vendorNameMap[shipVendorCode] || shipVendorCode,
          invoiceId: batchShipments[k][invoiceNoCol] || '',
          invoice_date: invDate ? Utilities.formatDate(new Date(invDate), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
          total_units: unitsPerShipment[shipId] || 0,
          carton_count: Number(batchShipments[k][cartonCountCol]) || 0,
          line_items: lineItemsPerShipment[shipId] || [],
          drive_folder_id: driveFolderIdCol >= 0 ? (batchShipments[k][driveFolderIdCol] || '') : '',
          drive_folder_url: driveFolderUrlCol >= 0 ? (batchShipments[k][driveFolderUrlCol] || '') : '',
          ee_po_status: eePoStatusCol >= 0 ? (batchShipments[k][eePoStatusCol] || '') : '',
          ee_po_reference: eePoReferenceCol >= 0 ? (batchShipments[k][eePoReferenceCol] || '') : '',
          ee_push_error: eePushErrorCol >= 0 ? (batchShipments[k][eePushErrorCol] || '') : ''
        });

        var shipEeStatus = eePoStatusCol >= 0 ? String(batchShipments[k][eePoStatusCol] || '').trim() : '';
        if (shipEeStatus === 'FAILED') {
          anyEeFailed = true;
          if (!firstEeError && eePushErrorCol >= 0) firstEeError = String(batchShipments[k][eePushErrorCol] || '');
        } else if (shipEeStatus === 'PUSHED') {
          anyEePushed = true;
        }
      }
      var eeStatus = anyEeFailed ? 'FAILED' : (anyEePushed ? 'PUSHED' : '');

      var expectedDelivery = batchesData[i][expectedDeliveryCol];
      var actualDelivery = batchesData[i][actualDeliveryCol];
      var isDelayed = false;
      var delayDays = 0;

      if (expectedDelivery && !actualDelivery) {
        var expectedDate = new Date(expectedDelivery);
        if (today > expectedDate) {
          isDelayed = true;
          delayDays = Math.floor((today - expectedDate) / (1000 * 60 * 60 * 24));
        }
      }

      batches.push({
        batch_id: batchId,
        batch_type: (batchesData[i][batchTypeCol] || 'sea').toLowerCase(),
        status: batchesData[i][statusCol] || 'Shipped',
        total_shipments: totalShipments,
        total_vendors: totalVendors,
        total_cartons: totalCartons,
        total_units: totalUnits,
        total_value_rmb: totalValueRmb,
        item_type_prefixes: Object.keys(batchPrefixSet),
        created_at: batchesData[i][createdAtCol] ? batchesData[i][createdAtCol].toISOString() : null,
        created_by: batchesData[i][createdByCol] || '',
        shipped_at: batchesData[i][shippedAtCol] ? batchesData[i][shippedAtCol].toISOString() : null,
        // Calendar dates, not instants — .toISOString() reports the UTC
        // instant of IST-midnight (18:30Z the *previous* day), which the
        // frontend's .split('T')[0] then read as the wrong calendar date.
        // Formatting in the script's own timezone sidesteps that entirely.
        expected_delivery: expectedDelivery ? Utilities.formatDate(expectedDelivery, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
        actual_delivery: actualDelivery ? Utilities.formatDate(actualDelivery, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
        // String() explicitly — an all-digit tracking number can come back
        // from Sheets as a JS number, which crashed the frontend's sort
        // comparator (.localeCompare is not a function on Number.prototype).
        tracking_number: String(batchesData[i][trackingCol] || ''),
        carrier: String(batchesData[i][carrierCol] || ''),
        notes: batchesData[i][notesCol] || '',
        is_delayed: isDelayed,
        delay_days: delayDays,
        ee_status: eeStatus,
        ee_push_error: firstEeError,
        vendor_shipments: vendorShipments
      });
    }

    var activeBatches = 0;
    var inTransitValue = 0;
    var delayedShipments = 0;

    for (var i = 0; i < batches.length; i++) {
      if (batches[i].status !== 'Delivered') {
        activeBatches++;
        // In-Transit Value should reflect goods actually moving — an OPEN
        // batch hasn't shipped yet, so its line-item value doesn't belong
        // in this number even though it's technically "active".
        if (batches[i].status !== 'OPEN') {
          inTransitValue += batches[i].total_value_rmb;
        }
      }
      if (batches[i].is_delayed) {
        delayedShipments++;
      }
    }

    var arrivingThisWeek = 0;
    var weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    for (var i = 0; i < batches.length; i++) {
      if (batches[i].expected_delivery && !batches[i].actual_delivery) {
        var expected = new Date(batches[i].expected_delivery);
        if (expected >= today && expected <= weekFromNow) {
          arrivingThisWeek++;
        }
      }
    }

    // ── Avg Transit Time (Air/Sea) — actual_delivery - shipped_at, Delivered batches only ──
    var airDays = [], seaDays = [];
    for (var i = 0; i < batches.length; i++) {
      var b = batches[i];
      if (b.status === 'Delivered' && b.shipped_at && b.actual_delivery) {
        var transitDays = (new Date(b.actual_delivery) - new Date(b.shipped_at)) / (1000 * 60 * 60 * 24);
        if (transitDays >= 0) {
          (b.batch_type === 'air' ? airDays : seaDays).push(transitDays);
        }
      }
    }
    var avgOf_ = function(arr) { return arr.length ? Math.round(arr.reduce(function(a, c) { return a + c; }, 0) / arr.length) : null; };

    var metrics = {
      activeBatches: activeBatches,
      inTransitValue: inTransitValue,
      arrivingThisWeek: arrivingThisWeek,
      delayedShipments: delayedShipments,
      newShipmentsThisWeek: newShipmentsThisWeek,
      avgTransitTimeAirDays: avgOf_(airDays),
      avgTransitTimeSeaDays: avgOf_(seaDays)
    };

    return {
      status: 'success',
      batches: batches,
      metrics: metrics
    };

  } catch (error) {
    Logger.log('Error in getBatches: ' + error.toString());
    throw new Error('Failed to fetch batches: ' + error.message);
  }
}

// ─────────────────────────────────────────────────────────────
// UPDATE SHIPMENT LINE FLAG (Logo / Pkg / Manual / OPP)
// Admin-only toggle on a single Vendor_Shipment_Lines row, used by the
// Shipment Tracker's SKU-line accordion. These are independently-editable
// columns on the line itself now, not derived from Purchase_Order_Lines —
// default false, overwritten in place on toggle (no seeding from the PO,
// no separate audit trail — same as every other editable field in this app).
// ensureHeaderColumn_ (accounting_logger.js) adds the column on first use if
// the sheet doesn't have it yet, so no manual sheet setup is required.
// ─────────────────────────────────────────────────────────────
var SHIPMENT_LINE_FLAG_COLUMNS_ = {
  logo: 'has_logo',
  packaging: 'has_packaging',
  manual: 'has_manual',
  opp_wrap: 'has_opp_wrap'
};

function apiUpdateShipmentLineFlag_(payload) {
  try {
    if (getUserRole_(payload && payload.user_email) !== 'ADMIN') {
      return { status: 'error', message: 'Admin access required to edit shipment line flags.' };
    }
    var lineId = String((payload && payload.line_id) || '').trim();
    var flag = String((payload && payload.flag) || '').trim();
    var value = !!(payload && payload.value);
    if (!lineId) return { status: 'error', message: 'line_id is required' };
    var columnName = SHIPMENT_LINE_FLAG_COLUMNS_[flag];
    if (!columnName) return { status: 'error', message: 'Unknown flag: ' + flag };

    var sheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENT_LINES);
    var colIdx = ensureHeaderColumn_(sheet, columnName); // 0-based

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var lineIdCol = headers.indexOf('line_id');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][lineIdCol] || '').trim() === lineId) {
        sheet.getRange(i + 1, colIdx + 1).setValue(value);
        return { status: 'success', line_id: lineId, flag: flag, value: value };
      }
    }
    return { status: 'error', message: 'Shipment line not found: ' + lineId };
  } catch (error) {
    Logger.log('Error in apiUpdateShipmentLineFlag_: ' + error.toString());
    return { status: 'error', message: 'Update failed: ' + error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// SKU / ITEM CROSS-BATCH SEARCH
// Used by: the new dedicated SKU/Item Search screen (Section D of the
// Shipment Tracker spec). Defaults to active/in-transit batches only;
// payload.includeDelivered:true also includes Delivered batches.
// Logistics-only (batch_id, vendor, quantity, status) — no finance fields,
// so this needs no role gating.
// ─────────────────────────────────────────────────────────────
function searchSkuShipments_(payload) {
  try {
    var query = String((payload && payload.query) || '').trim().toLowerCase();
    if (!query) return { status: 'error', message: 'query is required' };
    var includeDelivered = !!(payload && payload.includeDelivered);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var batchesData = ss.getSheetByName('Batches').getDataRange().getValues();
    var shipmentsData = ss.getSheetByName('Vendor_Shipments').getDataRange().getValues();
    var linesData = ss.getSheetByName('Vendor_Shipment_Lines').getDataRange().getValues();

    var batchHeaders = batchesData[0];
    var shipmentHeaders = shipmentsData[0];
    var lineHeaders = linesData[0];

    var bIdCol = batchHeaders.indexOf('batch_id');
    var bStatusCol = batchHeaders.indexOf('status');
    var bTypeCol = batchHeaders.indexOf('batch_type');
    var statusByBatch = {};
    var typeByBatch = {};
    for (var i = 1; i < batchesData.length; i++) {
      if (batchesData[i][bIdCol]) {
        statusByBatch[batchesData[i][bIdCol]] = batchesData[i][bStatusCol] || 'Shipped';
        typeByBatch[batchesData[i][bIdCol]] = (batchesData[i][bTypeCol] || 'sea').toLowerCase();
      }
    }

    var sIdCol = shipmentHeaders.indexOf('shipment_id');
    var sBatchIdCol = shipmentHeaders.indexOf('batch_id');
    var sVendorCol = shipmentHeaders.indexOf('vendor_code');
    var shipmentMeta = {};
    for (var j = 1; j < shipmentsData.length; j++) {
      var sid = shipmentsData[j][sIdCol];
      if (sid) {
        shipmentMeta[sid] = {
          batch_id: shipmentsData[j][sBatchIdCol],
          vendor_code: shipmentsData[j][sVendorCol]
        };
      }
    }

    var lSkuCol = lineHeaders.indexOf('sku');
    var lNameCol = lineHeaders.indexOf('item_name');
    var lShipIdCol = lineHeaders.indexOf('shipment_id');
    var lQtyCol = lineHeaders.indexOf('invoice_qty');

    var results = [];
    for (var k = 1; k < linesData.length; k++) {
      var sku = String(linesData[k][lSkuCol] || '');
      var itemName = String(linesData[k][lNameCol] || '');
      if (sku.toLowerCase().indexOf(query) === -1 && itemName.toLowerCase().indexOf(query) === -1) continue;

      var meta = shipmentMeta[linesData[k][lShipIdCol]];
      if (!meta) continue;
      var status = statusByBatch[meta.batch_id] || 'Shipped';
      if (!includeDelivered && status === 'Delivered') continue;

      results.push({
        batch_id: meta.batch_id,
        batch_type: typeByBatch[meta.batch_id] || 'sea',
        vendor_code: meta.vendor_code,
        sku: sku,
        item_name: itemName,
        quantity: Number(linesData[k][lQtyCol]) || 0,
        status: status
      });
    }

    return { status: 'success', results: results };

  } catch (error) {
    Logger.log('Error in searchSkuShipments_: ' + error.toString());
    return { status: 'error', message: 'Search failed: ' + error.message };
  }
}

function getBatchDetails(batchId, userEmail) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var batchesSheet = ss.getSheetByName('Batches');
    var batchesData = batchesSheet.getDataRange().getValues();
    var batchHeaders = batchesData[0];

    var batchIdCol = batchHeaders.indexOf('batch_id');
    var totalAmountCol = batchHeaders.indexOf('total_amount');
    var totalCurrencyCol = batchHeaders.indexOf('total_currency');
    var batchRow = null;

    for (var i = 1; i < batchesData.length; i++) {
      if (batchesData[i][batchIdCol] === batchId) {
        batchRow = batchesData[i];
        break;
      }
    }

    if (!batchRow) return null;

    var batch = {
      batch_id: batchId,
      batch_type: (batchRow[batchHeaders.indexOf('batch_type')] || 'sea').toLowerCase(),
      status: batchRow[batchHeaders.indexOf('status')] || 'Shipped',
      created_at: batchRow[batchHeaders.indexOf('created_at')] ? batchRow[batchHeaders.indexOf('created_at')].toISOString() : null,
      created_by: batchRow[batchHeaders.indexOf('created_by')] || '',
      shipped_at: batchRow[batchHeaders.indexOf('shipped_at')] ? batchRow[batchHeaders.indexOf('shipped_at')].toISOString() : null,
      // Calendar dates, not instants — see the same fix/comment in getBatches.
      expected_delivery: batchRow[batchHeaders.indexOf('expected_delivery')] ? Utilities.formatDate(batchRow[batchHeaders.indexOf('expected_delivery')], Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
      actual_delivery: batchRow[batchHeaders.indexOf('actual_delivery')] ? Utilities.formatDate(batchRow[batchHeaders.indexOf('actual_delivery')], Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
      tracking_number: batchRow[batchHeaders.indexOf('tracking_number')] || '',
      carrier: batchRow[batchHeaders.indexOf('carrier')] || '',
      notes: batchRow[batchHeaders.indexOf('notes')] || ''
    };

    var ctx = buildBatchAssemblyContext_();
    var vendorShipments = buildVendorShipmentsForBatch_(batchId, ctx);

    batch.total_shipments = vendorShipments.length;

    var vendorSet = {};
    for (var i = 0; i < vendorShipments.length; i++) {
      vendorSet[vendorShipments[i].vendor_code] = true;
    }
    batch.total_vendors = Object.keys(vendorSet).length;

    var totalCartons = 0;
    var totalUnitsAll = 0;
    for (var i = 0; i < vendorShipments.length; i++) {
      totalCartons += vendorShipments[i].carton_count;
      totalUnitsAll += vendorShipments[i].total_units;
    }
    batch.total_cartons = totalCartons;
    batch.total_units = totalUnitsAll;

    var today = new Date();
    if (batch.expected_delivery && !batch.actual_delivery) {
      var expectedDate = new Date(batch.expected_delivery);
      if (today > expectedDate) {
        batch.is_delayed = true;
        batch.delay_days = Math.floor((today - expectedDate) / (1000 * 60 * 60 * 24));
      } else {
        batch.is_delayed = false;
        batch.delay_days = 0;
      }
    } else {
      batch.is_delayed = false;
      batch.delay_days = 0;
    }

    batch.vendor_shipments = vendorShipments;

    // ── Admin-only finance enrichment ──────────────────────────────────────
    // Never attached for non-admins — not even as null fields.
    //
    // This used to also compute a blended FX rate (from FXRates, keyed by
    // the batch's shipped_at month) and derive amount_inr/payment_status
    // from it per batch and per shipment — one rate applied to every
    // shipment regardless of that shipment's own invoice_date, and wrong
    // whenever no FXRates row existed for that month even if fully paid.
    // The frontend now computes real payment status itself from
    // PurchaseInvoices/SettlementLedger via computeBatchSettlementStatus
    // (services/settlementService.ts) — the same function CNF Agent
    // Accounting already used — so that's removed here rather than left to
    // silently disagree with it.
    var isAdmin = getUserRole_(userEmail) === 'ADMIN';
    if (isAdmin) {
      batch.total_amount = totalAmountCol >= 0 ? (Number(batchRow[totalAmountCol]) || 0) : 0;
      batch.total_currency = totalCurrencyCol >= 0 ? (batchRow[totalCurrencyCol] || 'RMB') : 'RMB';

      var allPayments = getSheetData_('Payments');
      var batchPayments = allPayments.filter(function(p) { return p.batch_id === batchId; });

      // buildVendorShipmentsForBatch_ is logistics-only and doesn't carry
      // per-shipment total_amount/currency — read those raw off the same
      // Vendor_Shipments rows ctx already loaded, keyed by shipment_id.
      var shipAmountCol = ctx.shipmentHeaders.indexOf('total_amount');
      var shipCurrencyCol = ctx.shipmentHeaders.indexOf('currency');
      var shipIdColForFinance = ctx.shipmentHeaders.indexOf('shipment_id');
      var shipBatchIdColForFinance = ctx.shipmentHeaders.indexOf('batch_id');
      var shipmentFinanceRaw = {};
      for (var fi = 1; fi < ctx.shipmentsData.length; fi++) {
        if (ctx.shipmentsData[fi][shipBatchIdColForFinance] === batchId) {
          var fSid = String(ctx.shipmentsData[fi][shipIdColForFinance] || '').trim();
          shipmentFinanceRaw[fSid] = {
            total_amount: shipAmountCol >= 0 ? (Number(ctx.shipmentsData[fi][shipAmountCol]) || 0) : 0,
            currency: shipCurrencyCol >= 0 ? (ctx.shipmentsData[fi][shipCurrencyCol] || batch.total_currency) : batch.total_currency
          };
        }
      }

      vendorShipments.forEach(function(vs) {
        var raw = shipmentFinanceRaw[vs.shipment_id] || { total_amount: 0, currency: batch.total_currency };
        vs.total_amount = raw.total_amount;
        vs.currency = raw.currency;
      });

      batch.payments = batchPayments;
    }

    return { status: 'success', batch: batch };

  } catch (error) {
    Logger.log('Error in getBatchDetails: ' + error.toString());
    throw new Error('Failed to fetch batch details: ' + error.message);
  }
}

function buildBatchAssemblyContext_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shipmentsSheet = ss.getSheetByName('Vendor_Shipments');
  var linesSheet = ss.getSheetByName('Vendor_Shipment_Lines');
  var productSheet = ss.getSheetByName('EE Product Master');
  var poLineSheet = ss.getSheetByName('Purchase_Order_Lines');

  var shipmentsData = shipmentsSheet.getDataRange().getValues();
  var linesData = linesSheet.getDataRange().getValues();
  var productData = productSheet.getDataRange().getValues();
  var poLineData = poLineSheet.getDataRange().getValues();

  var shipmentHeaders = shipmentsData[0];
  var lineHeaders = linesData[0];
  var productHeaders = productData[0];
  var poLineHeaders = poLineData[0];

  var prodSkuCol = productHeaders.indexOf('SKU');
  var prodInventoryCol = productHeaders.indexOf('Inventory');
  var inventoryMap = {};
  for (var k = 1; k < productData.length; k++) {
    var prodSku = String(productData[k][prodSkuCol] || '').trim();
    if (prodSku) {
      inventoryMap[prodSku] = Number(productData[k][prodInventoryCol] || 0);
    }
  }

  var plPoIdCol = poLineHeaders.indexOf('po_id');
  var plSkuCol = poLineHeaders.indexOf('sku');
  var plLogoCol = poLineHeaders.indexOf('custom_logo');
  var plPkgCol = poLineHeaders.indexOf('custom_packaging');
  var plManualCol = poLineHeaders.indexOf('solving_manual');
  var plOppCol = poLineHeaders.indexOf('opp_wrap');

  var poFlagsMap = {};
  for (var p = 1; p < poLineData.length; p++) {
    var plPoId = String(poLineData[p][plPoIdCol] || '').trim();
    var plSku = String(poLineData[p][plSkuCol] || '').trim();
    if (plPoId && plSku) {
      var flagKey = plPoId + '__' + plSku;
      poFlagsMap[flagKey] = {
        has_logo: poLineData[p][plLogoCol] === true || poLineData[p][plLogoCol] === 'TRUE' || poLineData[p][plLogoCol] === 1,
        has_packaging: poLineData[p][plPkgCol] === true || poLineData[p][plPkgCol] === 'TRUE' || poLineData[p][plPkgCol] === 1,
        has_manual: poLineData[p][plManualCol] === true || poLineData[p][plManualCol] === 'TRUE' || poLineData[p][plManualCol] === 1,
        has_opp_wrap: poLineData[p][plOppCol] === true || poLineData[p][plOppCol] === 'TRUE' || poLineData[p][plOppCol] === 1
      };
    }
  }

  return {
    shipmentsData: shipmentsData, shipmentHeaders: shipmentHeaders,
    linesData: linesData, lineHeaders: lineHeaders,
    productData: productData, productHeaders: productHeaders,
    inventoryMap: inventoryMap, poFlagsMap: poFlagsMap
  };
}

function buildVendorShipmentsForBatch_(batchId, ctx) {
  var shipmentsData = ctx.shipmentsData, shipmentHeaders = ctx.shipmentHeaders;
  var linesData = ctx.linesData, lineHeaders = ctx.lineHeaders;
  var productHeaders = ctx.productHeaders, productData = ctx.productData;
  var inventoryMap = ctx.inventoryMap, poFlagsMap = ctx.poFlagsMap;

  var shipBatchIdCol = shipmentHeaders.indexOf('batch_id');
  var shipmentIdCol = shipmentHeaders.indexOf('shipment_id');
  var vendorCodeCol = shipmentHeaders.indexOf('vendor_code');
  var invoiceNoCol = shipmentHeaders.indexOf('invoice_no');
  var invoiceDateCol = shipmentHeaders.indexOf('invoice_date');
  var cartonCountCol = shipmentHeaders.indexOf('carton_count');
  var remarksCol = shipmentHeaders.indexOf('remarks');
  var driveFolderIdCol = shipmentHeaders.indexOf('drive_folder_id');
  var driveFolderUrlCol = shipmentHeaders.indexOf('drive_folder_url');
  var expectedDeliveryColShip = shipmentHeaders.indexOf('expected_delivery');
  var eePoStatusCol = shipmentHeaders.indexOf('ee_po_status');
  var eePoReferenceCol = shipmentHeaders.indexOf('ee_po_reference');
  var eePushErrorCol = shipmentHeaders.indexOf('ee_push_error');

  var batchShipments = [];
  for (var i = 1; i < shipmentsData.length; i++) {
    if (shipmentsData[i][shipBatchIdCol] === batchId) {
      batchShipments.push(shipmentsData[i]);
    }
  }

  var lineShipmentIdCol = lineHeaders.indexOf('shipment_id');
  var lineIdCol = lineHeaders.indexOf('line_id');
  var linePoIdCol = lineHeaders.indexOf('po_id');
  var skuCol = lineHeaders.indexOf('sku');
  var itemNameCol = lineHeaders.indexOf('item_name');
  var factoryCodeCol = lineHeaders.indexOf('factory_code');
  var eanCol = lineHeaders.indexOf('ean');
  var invoiceQtyCol = lineHeaders.indexOf('invoice_qty');

  var vendorShipments = [];

  for (var i = 0; i < batchShipments.length; i++) {
    var shipment = batchShipments[i];
    var shipmentId = shipment[shipmentIdCol];
    var vendorCode = shipment[vendorCodeCol];
    var invoiceNo = shipment[invoiceNoCol];
    var invoiceDate = shipment[invoiceDateCol];
    var cartonCount = shipment[cartonCountCol] || 0;
    var remarks = shipment[remarksCol] || '';
    var driveFolderId = driveFolderIdCol >= 0 ? (shipment[driveFolderIdCol] || '') : '';
    var driveFolderUrl = driveFolderUrlCol >= 0 ? (shipment[driveFolderUrlCol] || '') : '';
    var shipExpectedDelivery = expectedDeliveryColShip >= 0 && shipment[expectedDeliveryColShip]
      ? Utilities.formatDate(new Date(shipment[expectedDeliveryColShip]), Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : '';
    var eePoStatus = eePoStatusCol >= 0 ? (shipment[eePoStatusCol] || '') : '';
    var eePoReference = eePoReferenceCol >= 0 ? (shipment[eePoReferenceCol] || '') : '';
    var eePushError = eePushErrorCol >= 0 ? (shipment[eePushErrorCol] || '') : '';

    var shipmentLines = [];
    for (var j = 1; j < linesData.length; j++) {
      if (linesData[j][lineShipmentIdCol] === shipmentId) {
        shipmentLines.push(linesData[j]);
      }
    }

    var lineItems = [];
    var totalUnits = 0;

    for (var j = 0; j < shipmentLines.length; j++) {
      var line = shipmentLines[j];
      var sku = String(line[skuCol] || '').trim();
      var itemName = line[itemNameCol];
      var factoryCode = line[factoryCodeCol] || '';
      var ean = line[eanCol] || '';
      var incomingQty = Number(line[invoiceQtyCol]) || 0;

      totalUnits += incomingQty;

      var currentStock = inventoryMap[sku] || 0;
      var futureStock = currentStock + incomingQty;

      var linePoId = String(line[linePoIdCol] || '').trim();
      var poIds = linePoId
        ? linePoId.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
        : [];

      var flags = { has_logo: null, has_packaging: null, has_manual: null, has_opp_wrap: null };
      for (var f = 0; f < poIds.length; f++) {
        var fKey = poIds[f] + '__' + sku;
        if (poFlagsMap[fKey]) {
          flags = poFlagsMap[fKey];
          break;
        }
      }

      lineItems.push({
        line_id: line[lineIdCol] || '', sku: sku, item_name: itemName,
        factory_code: factoryCode, ean: ean, incoming_qty: incomingQty,
        current_stock: currentStock, future_stock: futureStock,
        has_logo: flags.has_logo, has_packaging: flags.has_packaging,
        has_manual: flags.has_manual, has_opp_wrap: flags.has_opp_wrap
      });
    }

    var vendorNameCol = productHeaders.indexOf('vendor_name');
    var vendorCodeProdCol = productHeaders.indexOf('vendor_code');
    var vendorName = vendorCode;

    for (var k = 1; k < productData.length; k++) {
      if (productData[k][vendorCodeProdCol] === vendorCode) {
        vendorName = productData[k][vendorNameCol] || vendorCode;
        break;
      }
    }

    vendorShipments.push({
      shipment_id: shipmentId, vendor_code: vendorCode, vendor_name: vendorName,
      invoice_no: invoiceNo, invoiceId: invoiceNo,
      invoice_date: invoiceDate ? Utilities.formatDate(new Date(invoiceDate), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      total_units: totalUnits, carton_count: Number(cartonCount), remarks: remarks,
      line_items: lineItems,
      drive_folder_id: driveFolderId, drive_folder_url: driveFolderUrl,
      expected_delivery: shipExpectedDelivery,
      ee_po_status: eePoStatus, ee_po_reference: eePoReference, ee_push_error: eePushError
    });
  }

  return vendorShipments;
}

function getCnfEligibleBatches() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var batchesSheet = ss.getSheetByName('Batches');
    var batchesData = batchesSheet.getDataRange().getValues();
    var batchHeaders = batchesData[0];

    var batchIdCol = batchHeaders.indexOf('batch_id');
    var batchTypeCol = batchHeaders.indexOf('batch_type');
    var statusCol = batchHeaders.indexOf('status');
    var createdAtCol = batchHeaders.indexOf('created_at');
    var carrierCol = batchHeaders.indexOf('carrier');
    var trackingCol = batchHeaders.indexOf('tracking_number');
    var expectedDeliveryCol = batchHeaders.indexOf('expected_delivery');

    var ctx = buildBatchAssemblyContext_();
    var result = [];

    for (var i = 1; i < batchesData.length; i++) {
      var row = batchesData[i];
      var batchId = row[batchIdCol];
      if (!batchId) continue;

      var status = row[statusCol] || '';
      if (status !== 'Delivered') continue;

      var batchTypeRaw = String(row[batchTypeCol] || 'sea').toLowerCase();
      var looksLikeSea = batchTypeRaw.indexOf('sea') !== -1 || String(batchId).indexOf('S-') === 0;
      if (!looksLikeSea) continue;

      var vendorShipments = buildVendorShipmentsForBatch_(batchId, ctx);

      var qty = 0, cartons = 0;
      for (var v = 0; v < vendorShipments.length; v++) {
        qty += vendorShipments[v].total_units;
        cartons += vendorShipments[v].carton_count;
      }

      var createdAt = row[createdAtCol];
      var expectedDelivery = row[expectedDeliveryCol];

      result.push({
        batch_id: batchId, status: status, batch_type: 'sea',
        created_at: createdAt ? createdAt.toISOString() : null,
        carrier: row[carrierCol] || '', waybill: row[trackingCol] || '',
        expected_delivery: expectedDelivery ? expectedDelivery.toISOString() : null,
        qty: qty, cartons: cartons, vendor_shipments: vendorShipments
      });
    }

    return { status: 'success', batches: result };
  } catch (error) {
    Logger.log('Error in getCnfEligibleBatches: ' + error.toString());
    throw new Error('Failed to fetch CNF-eligible batches: ' + error.message);
  }
}

/**
 * Entry point — orchestrates Phase 1 (SKU identification) then Phase 2 (product verification).
 * Signature is unchanged so all callers continue to work without modification.
 */
function performSKUMatching_(normalizedRows, productMaster) {
  const phase1Rows = performPhase1SKUIdentification_(normalizedRows, productMaster);
  return performPhase2ProductVerification_(phase1Rows, productMaster);
}

/**
 * Phase 1 – SKU Identification (2026-08 rewrite, full replacement of the
 * combined-AN+FC engine)
 *
 * Data mapping (packing list column → EE Product Master column):
 *   Barcode      → EAN         (via 'ean' field — sourced from 'EE Scan Identifier',
 *                                see loadEEProductMaster_)
 *   Factory Code → FC          (master 'Article Number' column → 'articleNumber')
 *   ID           → Accounting SKU (master 'Other Factory Item Code' column →
 *                                'otherFactoryCode' — EasyEcom's "Accounting SKU"
 *                                UI field is synced into this column, see
 *                                EEcom_api_code.js)
 *   MY ID        → SKU         (master 'SKU' column → 'sku', our own internal code)
 *
 * Steps are tried in this exact order; a step only runs if the previous one
 * found zero candidates in the master data at all (a step that finds ANY
 * candidate — even an ambiguous one — terminates the search):
 *   1. EAN
 *   2. Factory Code (FC)
 *   3. ID (Accounting SKU)
 *   4. UNMATCHED if none of the above find anything
 *
 * For whichever step succeeds, the result depends on two independent axes:
 *   (a) does MY ID agree with a candidate SKU found via this step?
 *       (agrees → MATCH, else → MISMATCH)
 *   (b) does this step's code value appear on more than one row in the
 *       CURRENT upload batch? (yes → '_MULTIPLE_VARIANT' suffix)
 * Whether the code mapped to one or several SKUs in the master only matters
 * for whether MY ID has multiple candidates to resolve between — it does not
 * change the final label once MY ID has (or hasn't) resolved it.
 *
 * Does NOT check price — that is Phase 2, now fully independent of this
 * result (see performPhase2ProductVerification_).
 */
function performPhase1SKUIdentification_(normalizedRows, productMaster) {
  var eanIndex = buildMasterCodeIndex_(productMaster, 'ean');
  var fcIndex  = buildMasterCodeIndex_(productMaster, 'articleNumber');
  var idIndex  = buildMasterCodeIndex_(productMaster, 'otherFactoryCode');

  var eanBatchCounts = countBatchCodeOccurrences_(normalizedRows, 'ean');
  // The frontend parser pipe-joins EVERY packing-list column that maps to the
  // canonical 'factory_code' field — which includes BOTH "ID" and "Factory Code"
  // headers (see COLUMN_MAP in VendorShipments.tsx). So a single row's
  // factory_code might be "SSX3105|X3-1000V3" (ID then FC) or just one piece,
  // depending on which columns the vendor's file actually has. Both the FC step
  // and the ID step read from this same source and try every piece against
  // their respective master field — this mirrors the old matchByCodesAgainstField_
  // approach rather than assuming a fixed position per piece.
  var codeBatchCounts = countBatchCodeOccurrences_(normalizedRows, 'factory_code');

  return normalizedRows.map(function(row) {
    var result =
      tryMatchStep_(row, row.ean, eanIndex, eanBatchCounts, 'EAN') ||
      tryMatchStep_(row, row.factory_code, fcIndex, codeBatchCounts, 'FACTORY_CODE') ||
      tryMatchStep_(row, row.factory_code, idIndex, codeBatchCounts, 'ACCOUNTING_SKU');

    if (result) {
      result.phase1_status = result.match_status;
      result.phase2_status = null;
      return result;
    }

    var enrichedUnmatched = enrichRowWithMatch_(row, null, 'UNMATCHED', null, null, null);
    enrichedUnmatched.match_comment = 'no match found';
    enrichedUnmatched.phase1_status = 'UNMATCHED';
    enrichedUnmatched.phase2_status = null;
    return enrichedUnmatched;
  });
}

/**
 * Builds code-value → [distinct products] index for one productMaster field,
 * so a single step can tell in one lookup whether a code maps to zero, one,
 * or several distinct SKUs in the master.
 */
function buildMasterCodeIndex_(productMaster, field) {
  var index = {};
  productMaster.forEach(function(p) {
    var val = p[field];
    if (!val) return;
    if (!index[val]) index[val] = [];
    if (!index[val].some(function(existing) { return existing.sku === p.sku; })) {
      index[val].push(p);
    }
  });
  return index;
}

/**
 * Counts how many times each individual (pipe-split) code value appears
 * across the current upload batch's `field` column.
 */
function countBatchCodeOccurrences_(rows, field) {
  var counts = {};
  rows.forEach(function(row) {
    var raw = row[field];
    if (!raw) return;
    String(raw).split('|').forEach(function(piece) {
      var val = piece.trim();
      if (!val) return;
      counts[val] = (counts[val] || 0) + 1;
    });
  });
  return counts;
}

/**
 * One matching step (EAN, FACTORY_CODE, or ACCOUNTING_SKU). `rawValue` may be
 * a single code or a pipe-delimited list (see comment above) — every piece is
 * tried against `index`, and all distinct SKUs found across all pieces are
 * pooled as candidates (mirrors the old matchByCodesAgainstField_ behavior).
 * Returns null to fall through to the next step only when NONE of the pieces
 * matched anything. Otherwise always resolves to a terminal
 * MATCH / MISMATCH (± _MULTIPLE_VARIANT) row.
 */
function tryMatchStep_(row, rawValue, index, batchCounts, stepLabel) {
  if (!rawValue) return null;
  var codes = String(rawValue).split('|').map(function(c) { return c.trim(); }).filter(Boolean);
  if (codes.length === 0) return null;

  var candidates = [];
  var matchedCodes = [];
  codes.forEach(function(code) {
    var hits = index[code];
    if (!hits || hits.length === 0) return;
    matchedCodes.push(code);
    hits.forEach(function(p) {
      if (!candidates.some(function(existing) { return existing.sku === p.sku; })) {
        candidates.push(p);
      }
    });
  });

  if (candidates.length === 0) return null; // none of the pieces matched anything — fall through

  var myId = row.my_id && String(row.my_id).trim() !== '' ? String(row.my_id).trim() : null;

  var resolvedCandidate;
  var myAgrees;
  if (candidates.length === 1) {
    resolvedCandidate = candidates[0];
    myAgrees = !!myId && myId === String(resolvedCandidate.sku).trim();
  } else {
    var found = candidates.filter(function(c) { return String(c.sku).trim() === myId; })[0];
    resolvedCandidate = found || null; // null = genuinely ambiguous, can't pick one
    myAgrees = !!found;
  }

  var isMultiRow = matchedCodes.some(function(code) { return (batchCounts[code] || 0) > 1; });
  var baseStatus = myAgrees ? 'MATCH' : 'MISMATCH';
  var finalStatus = isMultiRow ? (baseStatus + '_MULTIPLE_VARIANT') : baseStatus;

  var myIdCheck = myId
    ? { my_id_value: myId, agrees: myAgrees, mismatch_detail: myAgrees ? null : myId }
    : null;

  var comment;
  if (myAgrees) {
    comment = 'matched via ' + stepLabel + ' + my ID';
  } else if (myId) {
    comment = 'my ID not found / new variant';
  } else {
    comment = 'my ID is empty / new variant';
  }

  var enriched = enrichRowWithMatch_(
    row,
    resolvedCandidate || candidates[0],
    finalStatus,
    candidates.length > 1 ? candidates : null,
    null,
    myIdCheck
  );
  enriched.matched_by = stepLabel;
  enriched.matched_code = matchedCodes.join('|');
  enriched.match_confidence = stepLabel === 'EAN' ? 'HIGH' : 'MEDIUM';
  enriched.match_comment = comment;

  if (!resolvedCandidate) {
    // Ambiguous and unresolved by MY ID — don't claim a specific SKU, force manual pick.
    enriched.matched_sku = '';
    enriched.matched_name = '';
  }

  return enriched;
}

/**
 * Phase 2 – Product Verification (price only)
 *
 * Fully independent of match_status now — runs on any row that has a
 * matched_sku (MATCH or MISMATCH alike), so a MISMATCH row that still
 * resolved to a specific candidate SKU still gets priced-checked against it.
 * Skips UNMATCHED and genuinely-ambiguous unresolved rows (no matched_sku).
 *
 * Price rule is unchanged from before (checkPartialMatch_, 30% threshold) —
 * it just no longer mutates match_status. Result is its own independent tag,
 * price_check_status ('PASS' | 'FAIL' | null), shown as a separate badge
 * from the SKU-identity match_status.
 */
function performPhase2ProductVerification_(phase1Rows, productMaster) {
  var skuMap = {};
  productMaster.forEach(function(p) { skuMap[p.sku] = p; });

  return phase1Rows.map(function(row) {
    if (row.phase1_status === 'UNMATCHED' || !row.matched_sku) {
      row.phase2_status = null;
      row.price_check_status = null;
      return row;
    }

    var candidate = skuMap[row.matched_sku];
    if (!candidate) {
      // SKU no longer in master — nothing to verify against
      row.phase2_status = 'MATCH';
      row.price_check_status = 'PASS';
      return row;
    }

    var invoicePrice = Number(row.unit_price) || 0;
    var partialCheck = checkPartialMatch_(row, candidate, invoicePrice);

    row.phase2_status = partialCheck.isPartial ? 'PARTIAL_MATCH' : 'MATCH';
    row.price_check_status = partialCheck.isPartial ? 'FAIL' : 'PASS';

    if (partialCheck.isPartial) {
      row.partial_match_reason = partialCheck.reason;
      row.price_diff_percentage = partialCheck.priceDiff;
    }

    return row;
  });
}

/**
 * NEW: Check MY ID against matched SKU
 * MY ID from invoice = vendor's stored reference to our internal SKU
 * Returns null if MY ID is blank (no check needed)
 */
function checkMyId_(row, matchResult) {
  const myId = row.my_id && String(row.my_id).trim() !== '' ? String(row.my_id).trim() : null;
  if (!myId) return null; // No MY ID in invoice — skip check silently
  
  const matchedSku = matchResult ? String(matchResult.sku).trim() : '';
  const agrees = myId === matchedSku;
  
  return {
    my_id_value: myId,
    agrees: agrees,
    // If mismatch, show what MY ID says vs what we matched
    mismatch_detail: agrees ? null : myId
  };
}

function enrichRowWithMatch_(row, matchResult, matchStatus, allMatches = null, partialMatchInfo = null, myIdCheck = null) {
  const enriched = {
    ...row,
    match_status: matchStatus,
    matched_sku: matchResult ? matchResult.sku : '',
    matched_name: matchResult ? matchResult.productName : '',
    matched_by: matchResult ? matchResult.matchedBy : '',
    matched_code: matchResult ? matchResult.matchedCode : '',
    match_confidence: matchResult ? matchResult.matchConfidence : '',
    vendor_provided_sku: row.sku || row.factory_code || '',
    sku_mismatch_flag: matchStatus === 'SKU_MISMATCH',
    master_cost: matchResult ? matchResult.cost : 0,
    // ── NEW: MY ID cross-check result ──
    my_id_check: myIdCheck ? myIdCheck.agrees : null,       // true/false/null
    my_id_mismatch_value: myIdCheck ? myIdCheck.mismatch_detail : null, // the conflicting MY ID value
    // color is already carried through via ...row spread, no extra work needed
  };

  // Price variance (partial_match_reason / price_diff_percentage) is set directly
  // by performPhase2ProductVerification_ now — it's an independent tag, not tied
  // to a specific match_status value coming out of this function.

  if (allMatches) {
    enriched.multiple_matches = allMatches.map(m => ({
      sku: m.sku,
      name: m.productName,
      matchedBy: m.matchedBy,
      matchedCode: m.matchedCode,
      cost: m.cost
    }));
  }
  
  return enriched;
}

function testPoEmail() {
  sendPoEmailAndLog_(
    'PO-QY260213-1',       // ← real PO ID
    'QY',
    'nitesh@cubelelo.com',
    'nitesh@cubelelo.com',
    'test'
  );
  Logger.log('Test email sent');
}


function resendPoEmail(poId) {
  // Find vendor code from Purchase_Orders sheet
  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  const poData = poSheet.getDataRange().getValues();

  let vendorCode = null;
  let createdBy = null;

  for (let i = 1; i < poData.length; i++) {
    if (String(poData[i][poHeader.po_id]).trim() === poId) {
      vendorCode = poData[i][poHeader.vendor_code];
      createdBy = poData[i][poHeader.created_by];
      break;
    }
  }

  if (!vendorCode) {
    Logger.log('PO not found: ' + poId);
    return;
  }

  // Get vendor email
  const vendorSheet = getSheet_(SHEET_NAMES.VENDOR_MASTERS);
  const vendorHeader = getHeaderMap_(vendorSheet);
  const vendorData = vendorSheet.getDataRange().getValues();

  let emailTo = '';
  let emailCc = '';

  for (let i = 1; i < vendorData.length; i++) {
    if (String(vendorData[i][vendorHeader.vendor_code]).trim() === vendorCode) {
      emailTo = vendorData[i][vendorHeader.primary_email] || '';
      emailCc = vendorData[i][vendorHeader.cc_emails] || '';
      break;
    }
  }

  if (!emailTo) {
    Logger.log('No email found for vendor: ' + vendorCode);
    return;
  }

  Logger.log('Resending PO: ' + poId + ' to: ' + emailTo);
  sendPoEmailAndLog_(poId, vendorCode, emailTo, emailCc, createdBy || 'resend');
  Logger.log('Resend complete for: ' + poId);
}


function pushShipmentToEasyEcom_(shipmentId, vendorCode, expectedDelivery, lines, batchId) {
  try {
    const token = getEasyEcomToken();
    
    //const items = lines
     // .filter(line => line.matched_sku || line.sku)
     const items = lines
        .filter(line => (line.matched_sku || line.sku) && line.resolution_action !== 'REQUEST_NEW_SKU')
      .map(line => ({
        sku: line.matched_sku || line.sku,
        quantity: Number(line.invoice_qty || 0),
        unitPrice: Number(line.unit_price || 0)
      }))
      .filter(item => item.quantity > 0);
    
    if (items.length === 0) {
      Logger.log('pushShipmentToEasyEcom_: No valid items for ' + shipmentId);
      return { success: false, message: 'No valid items to push' };
    }
    
    const expDate = expectedDelivery
      ? new Date(expectedDelivery)
      : new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    
    // Suffixed (not prefixed) with batch_id so anything reading PO Ref Num's
    // leading characters (e.g. Inventory_forecasting_new_2.js's A-/S- transport-
    // mode sniff) keeps seeing the shipment ID exactly where it always has.
    const referenceCode = batchId ? `${shipmentId}|${batchId}` : shipmentId;

    const payload = {
      vendorId: vendorCode,
      referenceCode: referenceCode,
      expDeliveryDate: Utilities.formatDate(expDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      shippingCost: 0,
      createOrUpdate: 'I',
      isCancel: 0,
      items: items
    };
    
    Logger.log('pushShipmentToEasyEcom_ payload: ' + JSON.stringify(payload));
    
    const response = UrlFetchApp.fetch('https://api.easyecom.io/WMS/Cart/CreatePurchaseOrder', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'x-api-key': PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY'),
        'Content-Type': 'application/json'
      },
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const result = JSON.parse(response.getContentText());
    Logger.log('pushShipmentToEasyEcom_ response: ' + JSON.stringify(result));
    
    const eeSuccess = result.code === 200;
    const eePoId = eeSuccess ? String(result.data.poId) : '';
    const eeErrorMessage = eeSuccess ? '' : (result.message || JSON.stringify(result)).slice(0, 200);

    // Write result back to Vendor_Shipments row
    const shipmentSheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENTS);
    const shipmentHeader = getHeaderMap_(shipmentSheet);

    updateRowByKey_(shipmentSheet, shipmentHeader, 'shipment_id', shipmentId, {
      ee_po_status: eeSuccess ? 'PUSHED' : 'FAILED',
      ee_po_reference: eePoId,
      ee_push_error: eeErrorMessage
    });

    return { success: eeSuccess, poId: eePoId, message: eeErrorMessage };

  } catch (err) {
    Logger.log('pushShipmentToEasyEcom_ error: ' + err.message);
    // Best-effort: still record the failure on the shipment row so it isn't
    // silently lost (e.g. token fetch/network error before the API call).
    try {
      const shipmentSheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENTS);
      const shipmentHeader = getHeaderMap_(shipmentSheet);
      updateRowByKey_(shipmentSheet, shipmentHeader, 'shipment_id', shipmentId, {
        ee_po_status: 'FAILED',
        ee_push_error: String(err.message || err).slice(0, 200)
      });
    } catch (e2) {
      Logger.log('pushShipmentToEasyEcom_ failed to record error on shipment row: ' + e2.message);
    }
    return { success: false, message: err.message };
  }
}

/**
 * API: Retry pushing a shipment's PO to EasyEcom after a prior push failed
 * (or never happened). Rebuilds the request from the current Vendor_Shipments
 * row and Vendor_Shipment_Lines, so correcting the shipment's expected
 * delivery date (or anything else that caused the original push to fail)
 * before retrying picks up the fix automatically. Optionally accepts
 * `expected_delivery` to correct that field on the shipment row in the same
 * call, so an admin doesn't need two round-trips.
 *
 * Guards against creating a duplicate PO in EasyEcom: refuses to retry a
 * shipment whose ee_po_status is already PUSHED unless `force` is true.
 */
function apiRetryEasyEcomPush(payload) {
  const { shipment_id, expected_delivery, user_email, force } = payload;

  if (getUserRole_(user_email) !== 'ADMIN') {
    return { status: 'error', message: 'Admin access required to retry an EasyEcom push.' };
  }
  if (!shipment_id) {
    return { status: 'error', message: 'shipment_id is required' };
  }

  const shipmentSheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENTS);
  const shipmentHeader = getHeaderMap_(shipmentSheet);
  const shipmentData = shipmentSheet.getDataRange().getValues();

  let shipmentRow = null;
  for (let i = 1; i < shipmentData.length; i++) {
    if (String(shipmentData[i][shipmentHeader.shipment_id]).trim() === shipment_id) {
      shipmentRow = shipmentData[i];
      break;
    }
  }
  if (!shipmentRow) {
    return { status: 'error', message: 'Shipment not found: ' + shipment_id };
  }

  const currentEeStatus = String(shipmentRow[shipmentHeader.ee_po_status] || '').trim();
  if (currentEeStatus === 'PUSHED' && !force) {
    return {
      status: 'error',
      message: 'This shipment already has a PUSHED EasyEcom PO (ref ' +
        shipmentRow[shipmentHeader.ee_po_reference] + '). Retrying would risk creating a duplicate PO — pass force to override.'
    };
  }

  const vendorCode = shipmentRow[shipmentHeader.vendor_code];
  const batchId = shipmentRow[shipmentHeader.batch_id];

  // Vendor_Shipments doesn't actually carry a live expected_delivery column
  // on this sheet (writes to it below are a harmless no-op if so) —
  // Batches.expected_delivery is the real, persisted source of truth that
  // both the push-to-EasyEcom default and the Shipment Tracker / Batch
  // Detail UI read from. Fall back to it, not the shipment row.
  const batchSheet = getSheet_(SHEET_NAMES.BATCHES);
  const batchHeader = getHeaderMap_(batchSheet);
  const batchData = batchSheet.getDataRange().getValues();
  let batchRow = null;
  for (let i = 1; i < batchData.length; i++) {
    if (String(batchData[i][batchHeader.batch_id]).trim() === String(batchId).trim()) {
      batchRow = batchData[i];
      break;
    }
  }

  // If a corrected expected_delivery was supplied, sanity-check it (mirrors
  // EasyEcom's own rule: must be a future date) and persist it everywhere
  // the date is read from, so the record, the displayed batch ETA, and the
  // pushed PO all agree.
  let expectedDeliveryToUse = expected_delivery
    ? new Date(expected_delivery)
    : (shipmentRow[shipmentHeader.expected_delivery] || (batchRow ? batchRow[batchHeader.expected_delivery] : ''));

  if (expected_delivery) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (isNaN(expectedDeliveryToUse.getTime()) || expectedDeliveryToUse < today) {
      return { status: 'error', message: 'Expected delivery must be a valid date today or later.' };
    }
    updateRowByKey_(shipmentSheet, shipmentHeader, 'shipment_id', shipment_id, {
      expected_delivery: expectedDeliveryToUse
    });
    if (batchRow) {
      updateRowByKey_(batchSheet, batchHeader, 'batch_id', batchId, {
        expected_delivery: expectedDeliveryToUse
      });
    }
  }

  // Rebuild the line items the same way the original create-shipment flow did.
  const lineSheet = getSheet_(SHEET_NAMES.VENDOR_SHIPMENT_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();

  const lines = [];
  for (let i = 1; i < lineData.length; i++) {
    if (String(lineData[i][lineHeader.shipment_id]).trim() === shipment_id) {
      lines.push({
        sku: lineData[i][lineHeader.sku],
        invoice_qty: lineData[i][lineHeader.invoice_qty],
        unit_price: lineData[i][lineHeader.unit_price]
      });
    }
  }

  if (lines.length === 0) {
    return { status: 'error', message: 'No shipment lines found for ' + shipment_id + ' — nothing to push.' };
  }

  const eeResult = pushShipmentToEasyEcom_(shipment_id, vendorCode, expectedDeliveryToUse, lines, batchId);

  logAuditEvent_(
    'VENDOR_SHIPMENT', 'RETRY_EASYECOM_PUSH', shipment_id,
    eeResult.success ? ('PO created: ' + eeResult.poId) : ('Failed: ' + eeResult.message),
    eeResult.success ? 'SUCCESS' : 'FAILURE',
    user_email
  );

  return {
    status: eeResult.success ? 'success' : 'error',
    ee_push: eeResult.success ? 'PUSHED' : 'FAILED',
    ee_po_id: eeResult.poId || '',
    message: eeResult.success
      ? 'PO ' + eeResult.poId + ' created in EasyEcom.'
      : (eeResult.message || 'EasyEcom push failed.')
  };
}

function writeNewSKURequests_(shipmentId, vendorCode, validatedRows, userEmail) {
  try {
    const sheet = getSheet_('New_SKU_Requests');
    const header = getHeaderMap_(sheet);
    const now = new Date();
    
    // Find rows where user selected REQUEST_NEW_SKU as resolution action
    const skuRequestRows = validatedRows.filter(row =>
      row.resolution_action === 'REQUEST_New_SKU' ||
      row.resolution_action === 'REQUEST_NEW_SKU'
    );
    
    if (skuRequestRows.length === 0) {
      Logger.log('writeNewSKURequests_: No SKU requests for shipment ' + shipmentId);
      return { success: true, count: 0 };
    }
    
    skuRequestRows.forEach(row => {
      const requestId = 'NSR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      
      appendRowFromObject_(sheet, header, {
        request_id: requestId,
        shipment_id: shipmentId,
        vendor_code: vendorCode,
        factory_code: row.factory_code || '',
        //ean: row.ean || '',
        ean: row.ean && String(row.ean).trim() !== '' ? String(row.ean).trim() : '0',
        item_name: row.item_name || '',
        color: row.color || '',
        my_id: row.my_id || '',
        invoice_qty: Number(row.invoice_qty || 0),
        unit_price: Number(row.unit_price || 0),
        requested_by: userEmail,
        requested_at: now,
        status: 'PENDING',
        ee_sku: '',
        ee_product_name: '',
        notes: row.resolution_notes || '',
        resolved_at: '',
        resolved_by: ''
      });
    });
    
    Logger.log('writeNewSKURequests_: Wrote ' + skuRequestRows.length + ' SKU requests');
    return { success: true, count: skuRequestRows.length };

  } catch (err) {
    Logger.log('writeNewSKURequests_ error: ' + err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Registers ID / Price / EAN master-update requests raised on the Vendor Shipment
 * "ID / Price / EAN Review" tab into SKU_Update_Requests for admin review — does
 * NOT touch EasyEcom directly (that only happens once an admin approves the
 * request in Update SKU → Review Requests; see apiResolveSkuUpdateRequest in
 * 18_newskuapi.gs). One row is written per line item, consolidating whichever of
 * Factory Code / RMB Price / EAN were flagged, alongside a snapshot of the
 * current EE Product Master values for that SKU so the review screen can show
 * current-vs-proposed and later detect if the master has changed since.
 */
function writeFieldUpdateRequests_(shipmentId, vendorCode, validatedRows, userEmail) {
  try {
    const flaggedRows = validatedRows.filter(row =>
      (row.resolution_update_id && row.factory_code) ||
      (row.resolution_update_price && row.unit_price) ||
      (row.resolution_update_ean && row.ean)
    );
    if (flaggedRows.length === 0) {
      Logger.log('writeFieldUpdateRequests_: No field update requests for shipment ' + shipmentId);
      return { success: true, count: 0 };
    }

    const sheet = ensureSkuUpdateRequestsSheet_();
    const header = getHeaderMap_(sheet);
    const now = new Date();

    // SKU → master row map for snapshotting current values
    const productMaster = loadEEProductMaster_();
    const masterBySku = {};
    productMaster.forEach(p => { masterBySku[p.sku] = p; });

    flaggedRows.forEach((row, idx) => {
      const targetSku = row.matched_sku || row.sku || '';
      if (!targetSku) return;
      const master = masterBySku[targetSku] || {};

      const requestId = 'SUR-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '-' + idx;

      appendRowFromObject_(sheet, header, {
        request_id: requestId,
        shipment_id: shipmentId,
        vendor_code: vendorCode,
        target_sku: targetSku,
        item_name: row.matched_name || row.item_name || '',
        color: row.color || '',
        my_id: row.my_id || '',
        proposed_factory_code: row.resolution_update_id && row.factory_code
          ? String(row.factory_code).split('|')[0].trim() : '',
        proposed_ean: row.resolution_update_ean && row.ean ? String(row.ean).trim() : '',
        proposed_unit_price: row.resolution_update_price && row.unit_price ? Number(row.unit_price) : '',
        master_factory_code_snapshot: master.articleNumber || '',
        master_ean_snapshot: master.ean || '',
        master_unit_price_snapshot: master.cost || '',
        status: 'PENDING',
        requested_by: userEmail,
        requested_at: now,
        resolved_by: '',
        resolved_at: '',
        sync_notes: ''
      });
    });

    Logger.log('writeFieldUpdateRequests_: Wrote ' + flaggedRows.length + ' SKU update request(s)');
    return { success: true, count: flaggedRows.length };

  } catch (err) {
    Logger.log('writeFieldUpdateRequests_ error: ' + err.message);
    return { success: false, message: err.message };
  }
}


function testNewSKURequest() {
  // ── Test data — mimics an UNMATCHED row with REQUEST_NEW_SKU ──
  const testShipmentId = 'VS-TEST-SKU-' + Date.now();
  const testVendorCode = 'PW';
  const testUserEmail = Session.getActiveUser().getEmail();
  
  const testValidatedRows = [
    {
      // UNMATCHED row — user selected Request New SKU
      matched_sku: '',
      sku: '',
      factory_code: 'SSLZ01|7186A',
      ean: '6923039171869',
      item_name: 'ShengShou 6x6 Mastermorphix',
      color: 'stickerless',
      my_id: 'SSLZ01',
      invoice_qty: 1,
      unit_price: 76.44,
      match_status: 'UNMATCHED',
      resolution_action: 'REQUEST_NEW_SKU',
      resolution_notes: 'New product, not in master'
    },
    {
      // MATCH row — should be ignored by writeNewSKURequests_
      matched_sku: '1530010',
      sku: '1530010',
      factory_code: 'SSMB05|8203',
      ean: '6923039182032',
      item_name: 'SengSo 4x4 Magnetic Clock V2',
      color: 'black+white',
      my_id: '1530010',
      invoice_qty: 4,
      unit_price: 57.4,
      match_status: 'MATCH',
      resolution_action: 'ACCEPT',
      resolution_notes: ''
    }
  ];

  Logger.log('=== TEST: New SKU Request Write ===');
  Logger.log('Shipment ID: ' + testShipmentId);
  Logger.log('Vendor: ' + testVendorCode);
  Logger.log('Total rows: ' + testValidatedRows.length);
  Logger.log('REQUEST_NEW_SKU rows: ' + testValidatedRows.filter(r => r.resolution_action === 'REQUEST_NEW_SKU').length);

  // ── Run the function ────────────────────────────────────────
  Logger.log('\n--- Running writeNewSKURequests_ ---');
  const result = writeNewSKURequests_(testShipmentId, testVendorCode, testValidatedRows, testUserEmail);
  
  Logger.log('\n--- Result ---');
  Logger.log(JSON.stringify(result));
  
  if (result.success && result.count > 0) {
    Logger.log('\n✅ SUCCESS — ' + result.count + ' SKU request(s) written to New_SKU_Requests sheet');
    Logger.log('Check the New_SKU_Requests sheet for a PENDING row with shipment_id: ' + testShipmentId);
  } else if (result.success && result.count === 0) {
    Logger.log('\n⚠️ No rows written — check resolution_action filter matches exactly');
  } else {
    Logger.log('\n❌ FAILED — ' + result.message);
  }
}

function testGetBatches() {
  try {
    const result = getBatches();
    
    Logger.log('Total batches: ' + result.batches.length);
    
    if (result.batches.length > 0) {
      const firstBatch = result.batches[0];
      Logger.log('First batch ID: ' + firstBatch.batch_id);
      Logger.log('Has vendor_summary: ' + (firstBatch.vendor_summary !== undefined));
      Logger.log('vendor_summary value: ' + JSON.stringify(firstBatch.vendor_summary));
      Logger.log('Full first batch: ' + JSON.stringify(firstBatch));
    }
    
    Logger.log('SUCCESS');
  } catch (e) {
    Logger.log('ERROR: ' + e.toString());
  }
}

function apiClosePo_(payload) {
  const { po_id } = payload;
  if (!po_id) throw new Error('po_id is required');

  const now = new Date();

  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  const poData = poSheet.getDataRange().getValues();

  let poRowIndex = -1;
  for (let i = 1; i < poData.length; i++) {
    if (String(poData[i][poHeader.po_id]).trim() === po_id) {
      poRowIndex = i;
      break;
    }
  }
  if (poRowIndex === -1) throw new Error('PO not found: ' + po_id);

  const currentStatus = String(poData[poRowIndex][poHeader.po_status] || '').trim();
  if (currentStatus === 'CLOSED' || currentStatus === 'CLOSED_CANCELLED') {
    throw new Error('PO is already closed');
  }

  // Update PO header
  updateRowByKey_(poSheet, poHeader, 'po_id', po_id, {
    po_status: 'CLOSED',
    updated_at: now
  });

  // Update all non-FULFILLED lines in one pass
  const lineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();

  const updatedRows = [];
  for (let i = 1; i < lineData.length; i++) {
    if (
      String(lineData[i][lineHeader.po_id]).trim() === po_id &&
      String(lineData[i][lineHeader.line_status]).trim() !== 'FULFILLED'
    ) {
      lineData[i][lineHeader.line_status] = 'CLOSED';
      lineData[i][lineHeader.updated_at]  = now;
      updatedRows.push({ rowIndex: i + 1, rowData: lineData[i] });
    }
  }

  const totalCols = lineData[0].length;
  updatedRows.forEach(({ rowIndex, rowData }) => {
    lineSheet.getRange(rowIndex, 1, 1, totalCols).setValues([rowData]);
  });

  logAuditEvent_('PURCHASE_ORDER', 'CLOSE', po_id, `${updatedRows.length} line(s) closed`, 'SUCCESS', payload.closed_by);

  return { success: true, po_id, message: 'PO closed successfully' };
}

function apiGetPendingLines_(payload) {
  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  const poData = poSheet.getDataRange().getValues();

  // Build map of active POs: po_id → { po_date, planned_mode, vendor_code }
  const activePOMap = {};
  for (let i = 1; i < poData.length; i++) {
    const status = String(poData[i][poHeader.po_status] || '').trim().toUpperCase();
    if (status !== 'OPEN' && status !== 'PARTIALLY_SHIPPED') continue;
    const poId = String(poData[i][poHeader.po_id] || '').trim();
    if (!poId) continue;
    activePOMap[poId] = {
      po_date:      poData[i][poHeader.po_date] ? new Date(poData[i][poHeader.po_date]).toISOString() : '',
      planned_mode: poData[i][poHeader.planned_mode],
      vendor_code:  poData[i][poHeader.vendor_code]
    };
  }

  const lineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();

  const today = new Date();
  const rows = [];

  for (let i = 1; i < lineData.length; i++) {
    const poId = String(lineData[i][lineHeader.po_id] || '').trim();
    if (!activePOMap[poId]) continue;

    const lineStatus = String(lineData[i][lineHeader.line_status] || '').trim().toUpperCase();
    if (lineStatus !== 'OPEN' && lineStatus !== 'PARTIAL') continue;

    const po = activePOMap[poId];
    const orderedQty   = Number(lineData[i][lineHeader.ordered_qty]   || 0);
    const fulfilledQty = Number(lineData[i][lineHeader.fulfilled_qty] || 0);
    const poDate       = po.po_date ? new Date(po.po_date) : null;
    const daysPending  = poDate ? Math.floor((today - poDate) / (1000 * 60 * 60 * 24)) : 0;

    rows.push({
      po_id:             poId,
      vendor_code:       po.vendor_code,
      sku:               lineData[i][lineHeader.sku],
      sku_name:          lineData[i][lineHeader.sku_name],
      ordered_qty:       orderedQty,
      fulfilled_qty:     fulfilledQty,
      pending_qty:       orderedQty - fulfilledQty,
      days_pending:      daysPending,
      po_date:           po.po_date,
      planned_mode:      po.planned_mode,
      custom_logo:       lineData[i][lineHeader.custom_logo]       || false,
      custom_packaging:  lineData[i][lineHeader.custom_packaging]  || false,
      solving_manual:    lineData[i][lineHeader.solving_manual]    || false,
      opp_wrap:          lineData[i][lineHeader.opp_wrap]          || false,
      unit_price_rmb:    Number(lineData[i][lineHeader.unit_price_rmb] || 0)
    });
  }

  return { success: true, data: rows };
}

function apiGetSKUHistory_(payload) {
  const { sku } = payload;
  if (!sku) throw new Error('sku is required');
  const cleanSKU = String(sku).trim().toLowerCase();

  const poSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const poHeader = getHeaderMap_(poSheet);
  const poData = poSheet.getDataRange().getValues();

  // Build PO map: po_id → { po_date, planned_mode, vendor_code, po_status }
  const poMap = {};
  for (let i = 1; i < poData.length; i++) {
    const poId = String(poData[i][poHeader.po_id] || '').trim();
    if (!poId) continue;
    poMap[poId] = {
      po_date:      poData[i][poHeader.po_date] ? new Date(poData[i][poHeader.po_date]).toISOString() : '',
      planned_mode: poData[i][poHeader.planned_mode],
      vendor_code:  poData[i][poHeader.vendor_code],
      po_status:    poData[i][poHeader.po_status]
    };
  }

  const lineSheet = getSheet_(SHEET_NAMES.PURCHASE_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();

  const rows = [];

  for (let i = 1; i < lineData.length; i++) {
    const lineSKU = String(lineData[i][lineHeader.sku] || '').trim().toLowerCase();
    if (lineSKU !== cleanSKU) continue;

    const poId = String(lineData[i][lineHeader.po_id] || '').trim();
    const po   = poMap[poId] || { po_date: '', planned_mode: '', vendor_code: '', po_status: '' };

    const orderedQty   = Number(lineData[i][lineHeader.ordered_qty]   || 0);
    const fulfilledQty = Number(lineData[i][lineHeader.fulfilled_qty] || 0);
    const lineStatus   = String(lineData[i][lineHeader.line_status]   || '').trim();
    const updatedAt    = lineData[i][lineHeader.updated_at] ? new Date(lineData[i][lineHeader.updated_at]).toISOString() : '';

    let fulfillmentDays = null;
    if (lineStatus === 'FULFILLED' && po.po_date && updatedAt) {
      fulfillmentDays = Math.floor(
        (new Date(updatedAt) - new Date(po.po_date)) / (1000 * 60 * 60 * 24)
      );
    }

    rows.push({
      po_line_id:       lineData[i][lineHeader.po_line_id],
      po_id:            poId,
      vendor_code:      po.vendor_code,
      po_date:          po.po_date,
      planned_mode:     po.planned_mode,
      po_status:        po.po_status,
      ordered_qty:      orderedQty,
      fulfilled_qty:    fulfilledQty,
      pending_qty:      orderedQty - fulfilledQty,
      line_status:      lineStatus,
      unit_price_rmb:   Number(lineData[i][lineHeader.unit_price_rmb] || 0),
      fulfillment_days: fulfillmentDays,
      updated_at:       updatedAt
    });
  }

  // Sort by po_date DESC
  rows.sort((a, b) => {
    if (!a.po_date) return 1;
    if (!b.po_date) return -1;
    return new Date(b.po_date).getTime() - new Date(a.po_date).getTime();
  });

  return { success: true, sku: sku, data: rows };
}

