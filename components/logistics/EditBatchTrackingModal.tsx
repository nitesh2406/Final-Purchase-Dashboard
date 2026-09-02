import React, { useState, useEffect, useCallback } from 'react';
import { XMarkIcon, ExclamationTriangleIcon } from '../icons/Icons';
import { Batch, BatchStatus } from '../../types';
import { callGasAuthed } from '../../services/gasApi';
import { Button } from '../ui/Button';

const BATCH_STATUS_OPTIONS: BatchStatus[] = [
    'Shipped', 'In-Transit China', 'At Port China', 'In-Transit Ocean', 'In-Transit Air',
    'Customs Clearance', 'In-Transit India', 'Out for Delivery', 'Delivered'
];

interface EditBatchForm {
    carrier: string;
    tracking_number: string;
    expected_delivery: string;
    status: BatchStatus;
    notes: string;
    total_amount: number;
    total_currency: 'RMB' | 'USD';
}

interface EditBatchTrackingModalProps {
    batchId: string;
    onClose: () => void;
    onSaved: () => void;
}

export const EditBatchTrackingModal: React.FC<EditBatchTrackingModalProps> = ({ batchId, onClose, onSaved }) => {
    const [form, setForm] = useState<EditBatchForm | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const loadBatch = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const result = await callGasAuthed('get_batch_details', { batch_id: batchId });
            if (result.status === 'success') {
                const batch: Batch = result.batch;
                setForm({
                    carrier: batch.carrier || '',
                    tracking_number: batch.tracking_number || '',
                    expected_delivery: batch.expected_delivery ? batch.expected_delivery.split('T')[0] : '',
                    status: batch.status,
                    notes: batch.notes || '',
                    total_amount: batch.total_amount || 0,
                    total_currency: batch.total_currency || 'RMB'
                });
            } else {
                throw new Error(result.message || 'Failed to load batch details');
            }
        } catch (err: any) {
            setLoadError(err.message || 'Network error');
        } finally {
            setIsLoading(false);
        }
    }, [batchId]);

    useEffect(() => { loadBatch(); }, [loadBatch]);

    const handleSave = async () => {
        if (!form) return;
        setIsSaving(true);
        setSaveError(null);
        try {
            const result = await callGasAuthed('update_batch_tracking', { batch_id: batchId, ...form });
            if (result.status === 'success') {
                onSaved();
                onClose();
            } else {
                setSaveError(result.message || 'Update failed');
            }
        } catch (err: any) {
            setSaveError(err.message || 'Network error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl p-8 overflow-hidden animate-in zoom-in-95 duration-200 relative">
                <button onClick={onClose} className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                    <XMarkIcon className="w-6 h-6" />
                </button>

                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Edit Tracking — {batchId}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Update carrier, tracking, status, and amount for this batch.</p>

                {isLoading ? (
                    <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Loading current batch details...</div>
                ) : loadError ? (
                    <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 flex items-center gap-3">
                        <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0" />
                        <p className="text-red-600 dark:text-red-400 text-sm font-medium flex-1">{loadError}</p>
                        <button onClick={loadBatch} className="text-xs text-red-500 hover:text-red-700 font-bold underline">Retry</button>
                    </div>
                ) : form && (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Carrier</label>
                                <input type="text" value={form.carrier} onChange={e => setForm({ ...form, carrier: e.target.value })}
                                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tracking Number</label>
                                <input type="text" value={form.tracking_number} onChange={e => setForm({ ...form, tracking_number: e.target.value })}
                                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ETA</label>
                                <input type="date" value={form.expected_delivery} onChange={e => setForm({ ...form, expected_delivery: e.target.value })}
                                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</label>
                                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as BatchStatus })}
                                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100">
                                    {BATCH_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Amount</label>
                                <input type="number" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: Number(e.target.value) })}
                                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Currency</label>
                                <select value={form.total_currency} onChange={e => setForm({ ...form, total_currency: e.target.value as 'RMB' | 'USD' })}
                                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100">
                                    <option value="RMB">RMB</option>
                                    <option value="USD">USD</option>
                                </select>
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Notes</label>
                                <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100" placeholder="Internal notes..." />
                            </div>
                        </div>

                        {saveError && (
                            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-3 mt-4">
                                <p className="text-red-600 dark:text-red-400 text-sm font-medium">{saveError}</p>
                            </div>
                        )}

                        <div className="mt-6 flex justify-end gap-3">
                            <Button variant="secondary" onClick={onClose} disabled={isSaving}>Cancel</Button>
                            <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Changes'}</Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
