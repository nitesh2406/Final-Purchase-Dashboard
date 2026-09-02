# Post-Hoc Shipment Document Upload (Admin-Only) — Design

Date: 2026-09-02
Status: Approved by user, pending implementation plan

## Background

This is the deferred fast-follow from `docs/superpowers/specs/2026-09-02-shipment-tracker-inline-tracking-edit-design.md`'s out-of-scope section: today, uploading a shipment's documents (packing lists, invoices, photos, etc.) only happens during the Vendor Shipments creation wizard (`components/logistics/VendorShipments.tsx`'s `uploadShipmentDocumentsToDrive`), which posts to `/api/drive/upload-shipment-docs` and then records the resulting Drive folder on the shipment's Sheets row via `update_shipment_drive_docs`. There is no way today to add documents to a shipment that already exists — if files were missed at creation time, they're simply missing, with no in-app recovery path.

This design adds that recovery path: an Admin-only "Upload Documents" action per vendor-shipment in Batch Detail.

## Scope

**In scope:**
- A documents status indicator + upload trigger, Admin-only, in `VendorShipmentRow` (`components/logistics/BatchDetail.tsx`).
- A new `UploadShipmentDocsModal` component reusing the existing `/api/drive/upload-shipment-docs` endpoint and `update_shipment_drive_docs` action, both unchanged.
- One additive backend read-side change: `getBatchDetails` starts returning each vendor-shipment's `drive_folder_id`/`drive_folder_url` (columns that already exist on the Vendor_Shipments sheet but were never read back).

**Out of scope:**
- Any change to the Vendor Shipments creation wizard's own upload flow — it keeps working exactly as it does today.
- A conflict-resolution UI for colliding filenames (the creation wizard has one; this fast-follow deliberately doesn't — see Frontend section for why).
- Viewing/uploading documents from the Shipment Tracker table directly — this lives in Batch Detail, at the vendor-shipment level, since a batch can have multiple vendor-shipments and documents are scoped to one specific shipment, not the batch as a whole.
- Any change to how documents are displayed to non-Admin users — this whole capability (status indicator included) is Admin-only, matching how Edit Finance is already gated in the same component.

## Backend

**File:** `PO+Shipment Codes.js`, function `buildVendorShipmentsForBatch_` (called by `getBatchDetails`).

Add two column lookups alongside the function's existing ones:
```javascript
var driveFolderIdCol = shipmentHeaders.indexOf('drive_folder_id');
var driveFolderUrlCol = shipmentHeaders.indexOf('drive_folder_url');
```

Inside the per-shipment loop, read the values (columns may be `-1` if absent, though they're confirmed to already exist on the sheet per `apiUpdateShipmentDriveDocs`'s own guard clause):
```javascript
var driveFolderId = driveFolderIdCol >= 0 ? (shipment[driveFolderIdCol] || '') : '';
var driveFolderUrl = driveFolderUrlCol >= 0 ? (shipment[driveFolderUrlCol] || '') : '';
```

Add both to the object pushed onto `vendorShipments`:
```javascript
vendorShipments.push({
  shipment_id: shipmentId, vendor_code: vendorCode, vendor_name: vendorName,
  invoice_no: invoiceNo, invoiceId: invoiceNo,
  invoice_date: ...,
  total_units: totalUnits, carton_count: Number(cartonCount), remarks: remarks,
  line_items: lineItems,
  drive_folder_id: driveFolderId, drive_folder_url: driveFolderUrl
});
```

No other backend change. `/api/drive/upload-shipment-docs` and `update_shipment_drive_docs` are reused exactly as-is — `driveStorageService.getOrCreateShipmentFolder(batchId, shipmentId)` is already idempotent per batch+shipment, so calling it again for an existing shipment adds files to the same folder rather than creating a duplicate.

## Frontend

**`types.ts`:** add `drive_folder_id?: string; drive_folder_url?: string;` to `BatchVendorShipment`.

**`VendorShipmentRow` (`BatchDetail.tsx`):** next to the existing Admin-only "Edit Finance" toggle button, add (both Admin-only, same `isAdmin &&` gate already used for Edit Finance):
- A documents status indicator: if `vendor.drive_folder_url` is set, a link "View Documents ↗" (`target="_blank"`, opens the Drive folder); otherwise plain text "No documents yet".
- A button, "Upload Documents" (or "Add More Documents" if a folder already exists), opening the new modal for that specific `shipment_id`.

**New file `components/logistics/UploadShipmentDocsModal.tsx`:**
- Props: `{ batchId: string; shipmentId: string; vendorCode: string; onClose: () => void; onUploaded: () => void }`.
- Same modal-overlay convention as `EditBatchTrackingModal.tsx` (`fixed inset-0 bg-black/75 backdrop-blur-sm ... z-[200]`).
- A file input (`multiple`) staging files locally before upload; a removable list of staged files; "Upload" disabled until at least one file is staged.
- On Upload: builds a `FormData` (`batchId`, `shipmentId`, `vendorCode`, one `files` entry per staged file — no `conflictResolutions` field, meaning the server defaults every file to `onConflict: 'ask'`... **correction made during self-review: see below**), POSTs to `/api/drive/upload-shipment-docs` with `getSessionAuthHeaders()` attached (that route requires a session, same as the creation wizard's own call).

  **Self-review correction:** the design conversation said conflicts default to `keep_both`, but the server route's own default is `'ask'` per `req.body.conflictResolutions` being optional and `uploadFile`'s own `onConflict = params.onConflict || "ask"`. To actually get the intended `keep_both` behavior without building a conflict-resolution UI, the modal must explicitly send `conflictResolutions` as a JSON object mapping every staged file's name to `"keep_both"` — omitting the field would default to `"ask"`, which (per `driveStorageService.ts`) returns a `needs_resolution`-style result the modal has no UI to handle. So: build `conflictResolutions` client-side as `{ [fileName]: 'keep_both' }` for every staged file and always send it.
- Per-file results rendered after the response (`data.files`). With `keep_both` explicitly sent for every file, only two of `UploadResult`'s four possible shapes (`server/driveStorageService.ts`) can occur: `{ status: "uploaded", fileId, fileName, viewUrl, downloadUrl }` or `{ status: "failed", fileName, error }` — the modal only needs to branch on those two. A failed file shows inline (its `error` message) without blocking display of the others' success.
- On success (`data.success === true`): calls `callGasAuthed('update_shipment_drive_docs', { shipmentId, driveFolderId: data.folder.folderId, driveFolderUrl: data.folder.folderUrl })` — using `callGasAuthed`, matching `BatchDetail.tsx`'s established authed-call convention (not the creation wizard's older unauthenticated direct-fetch style for this same action). If this call fails, show a non-blocking warning ("Files uploaded successfully, but the document link may not appear until you refresh") rather than a full error — the files themselves are already safely in Drive regardless of whether this metadata write succeeds, mirroring the creation wizard's own "best-effort, non-fatal" comment for this exact call.
- On success, calls `onUploaded()` (which `BatchDetail.tsx` wires to its existing `loadBatch()` refetch) — the row's "View Documents" link then reflects the new folder. Does not auto-close the modal (so per-file results stay visible); a "Done" button closes it.
- On a total request failure (network error, non-2xx with no parseable per-file breakdown): inline error banner, same visual pattern as `EditBatchTrackingModal`'s `saveError` — modal stays open, staged files aren't cleared, so the admin can retry without re-selecting files.

## Edge Cases

- Shipment already has a folder → new files land in the same folder; no duplicate folder created.
- No files staged → Upload stays disabled.
- A file exceeds the server's existing 25MB-per-file limit → that file's entry in `data.files` comes back with a failed status; other files in the same request still succeed independently (`Promise.allSettled` server-side already guarantees this).
- `update_shipment_drive_docs` fails after a successful Drive upload → non-blocking warning, not a failure state (see Frontend section).
- Filename collision with an existing file in the same Drive folder → `keep_both` auto-renames rather than overwriting or asking, per the explicit `conflictResolutions` sent (see Frontend section's self-review correction).

## Testing Plan

- `npm run lint` stays at exactly the 2 known baseline errors.
- Backend: `clasp push --force`, confirm with the user, `clasp deploy`, then verify live via a direct `get_batch_details` call — confirm `drive_folder_id`/`drive_folder_url` appear (populated on any shipment that already has a recorded folder from a prior wizard upload, empty string otherwise) without breaking the rest of the response shape.
- Frontend, manually in the live app as Admin: open a vendor-shipment row in Batch Detail, confirm the documents status renders correctly (link vs. "No documents yet"), upload one or more test files, confirm per-file success rendering, confirm the row updates afterward to show "View Documents", click through to confirm the files actually landed in the correct Drive folder. Test a deliberate filename collision (upload the same file twice) to confirm `keep_both` behavior rather than an error or silent overwrite.
- Deploy discipline per CLAUDE.md: backend push/deploy (confirm first) verified live, then frontend commit/push/`vercel --prod` (confirm first) verified live via bundle grep.
