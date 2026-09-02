# Shipment Tracker — Inline Tracking Edit — Design

Date: 2026-09-02
Status: Approved by user, pending implementation plan

## Background

Admins currently have to open a batch's Batch Detail page and click "Edit Batch" to fix carrier/tracking/status/amount details that were missed or entered wrong when the shipment was first created. This is a two-step detour just to correct a handful of fields, and the user wants it reachable directly from the Shipment Tracker table row.

Batch Detail (`components/logistics/BatchDetail.tsx`) already has this exact edit capability — an `isEditingBatch` form (`BatchDetail.tsx:516-565`) that submits to the existing, already-deployed `update_batch_tracking` backend action. This design relocates that capability to a modal reachable from the Shipment Tracker table row, reusing the same fields, the same backend action, and the same full-payload convention — no backend changes.

## Scope

**In scope:**
- An Admin-only edit icon in each `ShipmentTracker.tsx` table row.
- A new modal (`EditBatchTrackingModal`) with the same field set as Batch Detail's edit form: Carrier, Tracking Number, Expected Delivery (ETA), Status, Total Amount, Total Currency, Notes.
- Wiring to the existing `get_batch_details` (to load fresh values on open) and `update_batch_tracking` (to save) actions — both already deployed, unchanged.

**Out of scope (this round, fast-follow):**
- Adding/uploading shipment files or documents after a shipment has already been created. That capability doesn't exist anywhere yet (today, file upload only happens during initial shipment creation in the Vendor Shipments wizard, via a Drive-upload flow scoped to a specific vendor-shipment). Building a post-hoc version is materially more work — it needs the Drive upload endpoint adapted for an existing shipment and a decision on which vendor-shipment within a (possibly multi-vendor) batch the files attach to. Separate design, later.
- Any change to Batch Detail's own edit form — it keeps working exactly as it does today; this is a second, independent entry point to the same backend action.

## Why full-payload, not partial-patch

`update_batch_tracking` has one known caller today (Batch Detail), and that caller always sends the complete field set — fetched fresh, then submitted whole, even when the admin only changed one field. There's no confirmed evidence the backend safely no-ops on omitted fields versus overwriting them with blanks, and backend source wasn't inspectable this session (clasp auth token is stale — `invalid_grant: invalid_rapt`, a known recurring issue per project notes; re-authenticating needs an interactive browser login this session couldn't complete). Rather than risk silently blanking Status/Total Amount/Currency/Notes on save, this design mirrors Batch Detail's proven-safe convention exactly: fetch the complete current record when the modal opens, show all the same fields, submit all of them back. If a future session confirms the backend does safe partial patches, the modal could be slimmed down then — not a blocker now.

## Frontend

**Trigger — `components/logistics/ShipmentTracker.tsx`:**
- Add one more `isAdmin`-gated `<th>` ("Edit") to the table header (`ShipmentTracker.tsx:475-489`) and a matching `<td>` per row (after `ShipmentTracker.tsx:540`) containing a small icon button (`PencilIcon`).
- The button's `onClick` must call `e.stopPropagation()` before opening the modal — the enclosing `<tr>` already has its own `onClick` that navigates to Batch Detail (`ShipmentTracker.tsx:498`), and without stopping propagation, clicking the edit icon would also trigger that navigation.
- Component state: `const [editingBatchId, setEditingBatchId] = useState<string | null>(null)`. Clicking the icon sets it; the modal renders when non-null, receiving `batchId={editingBatchId}` and `onClose={() => setEditingBatchId(null)}`.

**New file — `components/logistics/EditBatchTrackingModal.tsx`:**
- Props: `{ batchId: string; onClose: () => void; onSaved: () => void }`.
- On mount, calls `callGasAuthed('get_batch_details', { batch_id: batchId })` (same call Batch Detail makes) and populates local form state from the result, identically to `BatchDetail.tsx:252-260`:
  ```ts
  {
    carrier: batch.carrier,
    tracking_number: batch.tracking_number,
    expected_delivery: batch.expected_delivery ? batch.expected_delivery.split('T')[0] : '',
    status: batch.status,
    notes: batch.notes,
    total_amount: batch.total_amount,
    total_currency: batch.total_currency || 'RMB'
  }
  ```
- Shows a loading state while that fetch is in flight (the modal opens immediately on click, before data arrives, rather than waiting to open).
- Fields, in a centered modal card (styled after the existing `CancelDraftModal.tsx` overlay convention: `fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[200]`, card `bg-white dark:bg-slate-800 ... rounded-xl shadow-2xl`):
  - Carrier — text input
  - Tracking Number — text input
  - ETA — date input
  - Status — select, options = the same `BATCH_STATUS_OPTIONS` list from `BatchDetail.tsx:53-56` (`'Shipped'`, `'In-Transit China'`, `'At Port China'`, `'In-Transit Ocean'`, `'In-Transit Air'`, `'Customs Clearance'`, `'In-Transit India'`, `'Out for Delivery'`, `'Delivered'`) — duplicated into the new file rather than imported, since `BatchDetail.tsx` doesn't currently export it (a shared constant could be extracted later if a third consumer appears — not needed for two).
  - Total Amount — number input
  - Total Currency — select, options `RMB` / `USD` (matching `BatchDetail.tsx:551-552` exactly, not the `RMB`/`INR` guess from earlier in this design's brainstorming — confirmed against the actual source)
  - Notes — text input
- Save button calls `callGasAuthed('update_batch_tracking', { batch_id: batchId, ...form })`, mirroring `BatchDetail.tsx:316` exactly. On success: calls `onSaved()` then `onClose()`. On failure: shows an inline error message inside the modal (not a blocking `alert()` like Batch Detail uses today — a modal already has the user's focus, and an inline message doesn't require the "OK, now check what actually happened" step an `alert()` forces) and stays open with the form intact so nothing entered is lost.
- Cancel button and the `×` close icon both call `onClose()` directly with no confirmation prompt (nothing destructive has happened yet — this only edits local form state until Save is clicked).

**`ShipmentTracker.tsx`'s `onSaved` handler:** calls `fetchData(true)` — the same forced-refresh path the existing "Refresh Data" button uses — so the table reflects the change. Matches Batch Detail's own post-save behavior (`loadBatch()` refetch, `BatchDetail.tsx:320`) rather than hand-merging the response into local state.

## Edge Cases

- Opening the modal for a batch, then closing it without saving: no network write happens; nothing changes.
- `get_batch_details` failing when the modal opens (network error, batch since deleted): show the error inline in the modal in place of the form, with a Retry action — do not silently fall back to whatever summary fields the table row happened to have, since those don't include Notes/Total Currency at all.
- Saving with the Status changed to `'Delivered'`: no special handling — the backend already treats this batch-status field as authoritative wherever it's read (Shipment Tracker's own status badge, delay calculations, etc.); this modal doesn't duplicate any of that logic.
- Two admins editing the same batch concurrently: last-save-wins, identical to Batch Detail's existing behavior today — not a new risk introduced by this design.

## Testing Plan

- `npm run lint` must stay at exactly the 2 known baseline errors.
- No backend changes, so no backend deploy/verification needed for this piece.
- Manual, in the live app: as an Admin, open Shipment Tracker, click the edit icon on a row, confirm the modal loads the batch's real current values (cross-check against Batch Detail's own edit form for the same batch), change one field, save, confirm the table row updates and the modal closes. Confirm a non-Admin user sees no edit icon at all. Confirm clicking the edit icon does not also navigate to Batch Detail. Confirm Cancel/close discards changes. Confirm a forced save-failure (e.g., temporarily point at a bad batch_id) shows the inline error and keeps the modal open with the entered values intact.
- Deploy discipline per CLAUDE.md: commit/push, then `vercel --prod` (confirm first), verify live via bundle grep for a distinctive string.
