import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { fetchConversionCharge, saveConversionCharge } from '../../services/settlementService';

export const ChargesConfig: React.FC = () => {
    const [chargePercent, setChargePercent] = useState<string>('0');
    const [savedPercent, setSavedPercent] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const pct = await fetchConversionCharge();
                setChargePercent(String(pct));
                setSavedPercent(pct);
            } catch {
                setError('Could not load current conversion charge %. Defaulting to 0.');
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    const parsed = parseFloat(chargePercent);
    const isValid = !isNaN(parsed) && parsed >= 0;
    const hasChanges = isValid && parsed !== savedPercent;

    const handleSave = async () => {
        if (!isValid) return;
        setIsSaving(true);
        setError(null);
        setSuccessMessage(null);
        try {
            const saved = await saveConversionCharge(parsed);
            setSavedPercent(saved);
            setChargePercent(String(saved));
            setSuccessMessage('Conversion charge % updated. Applies to payments logged from now on — already-logged payments keep their original settled rate.');
        } catch (err: any) {
            setError(err.message || 'Failed to save conversion charge %.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Conversion Charge</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    The percentage of a payment's entered exchange rate that reflects money-transfer/conversion charges rather than the real market rate. Used to derive each payment's Settled ER2 (adjusted ER = ER ÷ (1 + charge%)) for forex gain/loss calculations.
                </p>
            </div>

            <Card>
                {isLoading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading current setting…</p>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="conversion-charge-pct" className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                                Conversion Charge %
                            </label>
                            <div className="flex items-center gap-2 max-w-xs">
                                <input
                                    id="conversion-charge-pct"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={chargePercent}
                                    onChange={e => { setChargePercent(e.target.value); setSuccessMessage(null); }}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition"
                                />
                                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">%</span>
                            </div>
                            {!isValid && (
                                <p className="text-xs text-red-500 mt-1.5">Enter a non-negative number.</p>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            <Button onClick={handleSave} disabled={!isValid || !hasChanges || isSaving}>
                                {isSaving ? 'Saving…' : 'Save'}
                            </Button>
                            <span className="text-xs text-slate-400">Currently applied: {savedPercent}%</span>
                        </div>

                        {error && <p className="text-sm text-red-500">{error}</p>}
                        {successMessage && <p className="text-sm text-emerald-600 dark:text-emerald-400">{successMessage}</p>}
                    </div>
                )}
            </Card>
        </div>
    );
};
