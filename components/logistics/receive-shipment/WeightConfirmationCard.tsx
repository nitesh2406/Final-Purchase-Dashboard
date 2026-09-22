import React, { useEffect, useRef, useState } from 'react';
import { ScaleIcon, ChevronUpIcon, ChevronDownIcon, PlusIcon, XMarkIcon, CameraIcon, CheckIcon, ExclamationTriangleIcon, ArrowPathIcon } from '../../icons/Icons';
import { callGasAuthed } from '../../../services/gasApi';
import { getSessionAuthHeaders } from '../../../services/authToken';

const MAX_PHOTOS = 15;
const UPLOAD_BATCH_SIZE = 3;
const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_JPEG_QUALITY = 0.75;

interface WeightRow {
  id: string;
  listedWeight: string;
  measuredWeight: string;
}

interface WeightConfirmationCardProps {
  shipmentId: string;
  batchId: string;
  vendorCode: string;
  existingListedWeight?: number | null;
  existingActualWeight?: number | null;
  onCompletionChange: (complete: boolean) => void;
}

const isRowFilled = (r: WeightRow) => r.measuredWeight.trim() !== '' && parseFloat(r.measuredWeight) > 0;

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/**
 * AIR-shipment-only gate shown above the scanner: staff record listed vs
 * measured carton weight (+ optional reference photos) before scanning
 * unlocks. Weights are written to Vendor_Shipments.listed_weight/actual_weight
 * (update_shipment_weights); photos reuse the same Drive upload + doc-link
 * write-back as Shipment Tracker's "Upload Documents" so they show up under
 * the same "View Documents" link there.
 */
export const WeightConfirmationCard: React.FC<WeightConfirmationCardProps> = ({
    shipmentId, batchId, vendorCode, existingListedWeight, existingActualWeight, onCompletionChange
}) => {
  const makeRow = (listedWeight = '', measuredWeight = ''): WeightRow => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, listedWeight, measuredWeight,
  });
  const hasExistingWeight = (existingActualWeight ?? 0) > 0 || (existingListedWeight ?? 0) > 0;

  const [rows, setRows] = useState<WeightRow[]>(() => [makeRow(
    existingListedWeight ? String(existingListedWeight) : '',
    existingActualWeight ? String(existingActualWeight) : ''
  )]);
  const [expanded, setExpanded] = useState(true);
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [compressingPhotos, setCompressingPhotos] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allWeighed = rows.length > 0 && rows.every(isRowFilled);

  useEffect(() => {
    if (!hasExistingWeight) return;
    setRows(prev => {
      const pristine = prev.every(r => r.listedWeight === '' && r.measuredWeight === '');
      if (!pristine) return prev;
      return [makeRow(existingListedWeight ? String(existingListedWeight) : '', existingActualWeight ? String(existingActualWeight) : '')];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingListedWeight, existingActualWeight, hasExistingWeight]);

  useEffect(() => {
    const urls = images.map(f => URL.createObjectURL(f));
    setPreviews(urls);
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [images]);

  useEffect(() => { onCompletionChange(confirmed); }, [confirmed, onCompletionChange]);

  const updateRow = (id: string, field: 'listedWeight' | 'measuredWeight', value: string) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
    setConfirmed(false);
    setConfirmError(null);
  };
  const addRow = () => { setRows(prev => [...prev, makeRow()]); setConfirmed(false); setConfirmError(null); };
  const removeRow = (id: string) => {
    setRows(prev => (prev.length > 1 ? prev.filter(r => r.id !== id) : prev));
    setConfirmed(false);
    setConfirmError(null);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const incoming = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, MAX_PHOTOS);
    if (!incoming.length) return;
    setCompressingPhotos(true);
    try {
      const compressed = await Promise.all(incoming.map(compressImage));
      setImages(prev => [...prev, ...compressed].slice(0, MAX_PHOTOS));
      setConfirmed(false);
      setConfirmError(null);
    } finally {
      setCompressingPhotos(false);
    }
  };
  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
    setConfirmed(false);
    setConfirmError(null);
  };

  const totalListed = rows.reduce((sum, r) => sum + (parseFloat(r.listedWeight) || 0), 0);
  const totalMeasured = rows.reduce((sum, r) => sum + (parseFloat(r.measuredWeight) || 0), 0);
  const diff = totalMeasured - totalListed;
  const hasAnyWeight = totalListed > 0 || totalMeasured > 0;

  const handleConfirm = async () => {
    if (!allWeighed || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const weightsResult = await callGasAuthed('update_shipment_weights', {
        shipment_id: shipmentId, listed_weight: totalListed, actual_weight: totalMeasured,
      });
      if (weightsResult.status !== 'success' && weightsResult.success !== true) {
        throw new Error(weightsResult.message || weightsResult.error || 'Failed to save weights');
      }

      for (let i = 0; i < images.length; i += UPLOAD_BATCH_SIZE) {
        const batch = images.slice(i, i + UPLOAD_BATCH_SIZE);
        const form = new FormData();
        form.append('batchId', batchId);
        form.append('shipmentId', shipmentId);
        form.append('vendorCode', vendorCode);
        const conflictResolutions: Record<string, string> = {};
        batch.forEach(img => { form.append('files', img, img.name); conflictResolutions[img.name] = 'keep_both'; });
        form.append('conflictResolutions', JSON.stringify(conflictResolutions));

        const uploadRes = await fetch('/api/drive/upload-shipment-docs', { method: 'POST', headers: getSessionAuthHeaders(), body: form });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadData.success) throw new Error(uploadData.error || 'Photo upload failed');

        await callGasAuthed('update_shipment_drive_docs', {
          shipmentId, driveFolderId: uploadData.folder.folderId, driveFolderUrl: uploadData.folder.folderUrl,
        });
      }

      setConfirmed(true);
    } catch (err: any) {
      setConfirmError(err.message || 'Failed to save weight confirmation.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-500/30 rounded-xl shadow-sm overflow-hidden">
      <button type="button" onClick={() => setExpanded(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-50/50 dark:hover:bg-slate-700/40 transition-colors">
        <div className="flex items-center gap-2 flex-wrap">
          <ScaleIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Weight Confirmation</h2>
          <span className="text-[9px] uppercase bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded font-bold tracking-wider">Air Shipment</span>
          {confirmed ? (
            <span className="text-[9px] uppercase bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded font-bold tracking-wider">Confirmed</span>
          ) : allWeighed ? (
            <span className="text-[9px] uppercase bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded font-bold tracking-wider">Ready to confirm</span>
          ) : (
            <span className="text-[9px] uppercase bg-red-100 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded font-bold tracking-wider">Incomplete — scanning locked</span>
          )}
        </div>
        {expanded ? <ChevronUpIcon className="w-4 h-4 text-slate-400" /> : <ChevronDownIcon className="w-4 h-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-4">
          {hasExistingWeight && (
            <div className="flex items-center gap-2 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 rounded-lg px-3 py-2 text-[11px] text-sky-700 dark:text-sky-300">
              <CheckIcon className="w-3.5 h-3.5 shrink-0" />
              <span>
                Previously recorded: Listed <strong className="font-mono">{existingListedWeight ? existingListedWeight.toFixed(2) : '—'} kg</strong>
                {' '}/ Measured <strong className="font-mono">{existingActualWeight ? existingActualWeight.toFixed(2) : '—'} kg</strong> — loaded below, edit if needed or just confirm to proceed.
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[420px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] uppercase font-bold text-slate-500">
                  <th className="py-2 px-3">Carton #</th>
                  <th className="py-2 px-3">Listed Weight (kg)</th>
                  <th className="py-2 px-3">Measured Weight (kg)</th>
                  <th className="py-2 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs">
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="py-1.5 px-3 font-mono text-slate-500">#{i + 1}</td>
                    <td className="py-1.5 px-3">
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={r.listedWeight} onChange={e => updateRow(r.id, 'listedWeight', e.target.value)} placeholder="0.00"
                        className="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white font-mono transition" />
                    </td>
                    <td className="py-1.5 px-3">
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={r.measuredWeight} onChange={e => updateRow(r.id, 'measuredWeight', e.target.value)} placeholder="0.00"
                        className="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white font-mono transition" />
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <button type="button" onClick={() => removeRow(r.id)} disabled={rows.length === 1} className="text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Remove carton">
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 1 && (
                <tfoot>
                  <tr className="border-t border-slate-200 dark:border-slate-700 text-xs font-bold">
                    <td className="py-2 px-3 text-slate-500">Total</td>
                    <td className="py-2 px-3 font-mono text-slate-900 dark:text-white">{totalListed.toFixed(2)}</td>
                    <td className="py-2 px-3 font-mono text-slate-900 dark:text-white">{totalMeasured.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors">
              <PlusIcon className="w-3.5 h-3.5" /> Add Carton
            </button>
            {hasAnyWeight && Math.abs(diff) > 0.001 && (
              <span className={`text-[10px] font-bold ${diff > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                Diff: {diff > 0 ? '+' : ''}{diff.toFixed(2)} kg
              </span>
            )}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Photos ({images.length}/{MAX_PHOTOS})</h3>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={images.length >= MAX_PHOTOS || compressingPhotos}
                className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 px-2.5 py-1 rounded-lg transition-colors">
                {compressingPhotos ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <CameraIcon className="w-3 h-3" />}
                {compressingPhotos ? 'Processing…' : 'Add Photo'}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
            </div>

            {images.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-slate-400 dark:text-slate-500 text-[11px] gap-1.5 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                No photos added yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {previews.map((src, i) => (
                  <div key={i} className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 aspect-square bg-slate-100 dark:bg-slate-950">
                    <img src={src} alt={`Weight confirmation photo ${i + 1}`} className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removeImage(i)} className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white rounded-full p-1 transition-colors" title="Remove photo">
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-2">Photos are uploaded to this shipment's Drive folder (same one used by "Upload Documents" on Shipment Tracker).</p>
          </div>

          {confirmError && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
              <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" /> {confirmError}
            </div>
          )}

          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex items-center justify-end gap-2">
            {confirmed && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                <CheckIcon className="w-3.5 h-3.5" /> Weights confirmed — scanning unlocked
              </span>
            )}
            <button type="button" onClick={handleConfirm} disabled={!allWeighed || confirmed || confirming}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-[11px] font-bold uppercase tracking-wider py-2 px-4 rounded-lg transition-colors">
              {confirming ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <CheckIcon className="w-3.5 h-3.5" />}
              {confirming ? 'Saving…' : confirmed ? 'Confirmed' : 'Confirm Weights'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
