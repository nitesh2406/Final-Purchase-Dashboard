import React, { useState } from 'react';
import { XMarkIcon, ExclamationTriangleIcon, CloudArrowUpIcon, CheckIcon } from '../icons/Icons';
import { callGasAuthed } from '../../services/gasApi';
import { getSessionAuthHeaders } from '../../services/authToken';
import { Button } from '../ui/Button';

interface FileResult {
    fileName: string;
    status: 'uploaded' | 'failed';
    error?: string;
    viewUrl?: string;
}

interface UploadShipmentDocsModalProps {
    batchId: string;
    shipmentId: string;
    vendorCode: string;
    onClose: () => void;
    onUploaded: () => void;
}

export const UploadShipmentDocsModal: React.FC<UploadShipmentDocsModalProps> = ({ batchId, shipmentId, vendorCode, onClose, onUploaded }) => {
    const [stagedFiles, setStagedFiles] = useState<File[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [results, setResults] = useState<FileResult[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [metadataWarning, setMetadataWarning] = useState<string | null>(null);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = Array.from(e.target.files || []);
        setStagedFiles(prev => {
            const existingNames = new Set(prev.map(f => f.name));
            return [...prev, ...selected.filter(f => !existingNames.has(f.name))];
        });
        e.target.value = '';
    };

    const removeStagedFile = (name: string) => {
        setStagedFiles(prev => prev.filter(f => f.name !== name));
    };

    const handleUpload = async () => {
        if (stagedFiles.length === 0) return;
        setIsUploading(true);
        setError(null);
        setMetadataWarning(null);
        try {
            const formData = new FormData();
            formData.append('batchId', batchId);
            formData.append('shipmentId', shipmentId);
            formData.append('vendorCode', vendorCode);
            const conflictResolutions: Record<string, string> = {};
            stagedFiles.forEach(f => {
                formData.append('files', f, f.name);
                conflictResolutions[f.name] = 'keep_both';
            });
            formData.append('conflictResolutions', JSON.stringify(conflictResolutions));

            const response = await fetch('/api/drive/upload-shipment-docs', {
                method: 'POST',
                headers: getSessionAuthHeaders(),
                body: formData
            });

            let data: any;
            try {
                data = await response.json();
            } catch {
                data = { success: false, error: `Upload endpoint returned an unexpected response (HTTP ${response.status})` };
            }

            if (data.success) {
                setResults((data.files || []).map((f: any) => ({
                    fileName: f.fileName,
                    status: f.status === 'uploaded' ? 'uploaded' : 'failed',
                    error: f.error,
                    viewUrl: f.viewUrl
                })));
                setStagedFiles([]);

                try {
                    const metaResult = await callGasAuthed('update_shipment_drive_docs', {
                        shipmentId,
                        driveFolderId: data.folder.folderId,
                        driveFolderUrl: data.folder.folderUrl
                    });
                    if (metaResult.status !== 'success') {
                        setMetadataWarning('Files uploaded successfully, but the document link may not appear until you refresh.');
                    }
                } catch {
                    setMetadataWarning('Files uploaded successfully, but the document link may not appear until you refresh.');
                }

                onUploaded();
            } else {
                setError(data.error || 'Failed to upload documents');
            }
        } catch (err: any) {
            setError(err.message || 'Network error');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-8 overflow-hidden animate-in zoom-in-95 duration-200 relative">
                <button onClick={onClose} className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                    <XMarkIcon className="w-6 h-6" />
                </button>

                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Upload Documents</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Shipment {shipmentId} — {vendorCode}</p>

                {!results && (
                    <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-6 cursor-pointer hover:border-blue-500 transition-colors">
                        <CloudArrowUpIcon className="w-8 h-8 text-slate-400" />
                        <span className="text-sm text-slate-500 dark:text-slate-400">Click to select files</span>
                        <input type="file" multiple className="hidden" onChange={handleFileInputChange} disabled={isUploading} />
                    </label>
                )}

                {stagedFiles.length > 0 && (
                    <ul className="mt-4 space-y-2">
                        {stagedFiles.map(f => (
                            <li key={f.name} className="flex items-center justify-between bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 text-sm">
                                <span className="text-slate-700 dark:text-slate-300 truncate">{f.name}</span>
                                <button onClick={() => removeStagedFile(f.name)} disabled={isUploading} className="text-slate-400 hover:text-red-500 transition-colors ml-2 shrink-0">
                                    <XMarkIcon className="w-4 h-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {results && (
                    <ul className="mt-4 space-y-2">
                        {results.map(r => (
                            <li key={r.fileName} className="flex items-center gap-2 text-sm">
                                {r.status === 'uploaded'
                                    ? <CheckIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                                    : <ExclamationTriangleIcon className="w-4 h-4 text-red-500 shrink-0" />}
                                <span className="text-slate-700 dark:text-slate-300 truncate">{r.fileName}</span>
                                {r.status === 'failed' && <span className="text-red-500 text-xs">— {r.error}</span>}
                            </li>
                        ))}
                    </ul>
                )}

                {metadataWarning && (
                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3 mt-4">
                        <p className="text-amber-700 dark:text-amber-400 text-sm font-medium">{metadataWarning}</p>
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-3 mt-4">
                        <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
                    </div>
                )}

                <div className="mt-6 flex justify-end gap-3">
                    <Button variant="secondary" onClick={onClose}>{results ? 'Done' : 'Cancel'}</Button>
                    {!results && (
                        <Button onClick={handleUpload} disabled={isUploading || stagedFiles.length === 0}>
                            {isUploading ? 'Uploading...' : `Upload${stagedFiles.length > 0 ? ` (${stagedFiles.length})` : ''}`}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};
