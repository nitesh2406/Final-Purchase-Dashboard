import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { fetchConversionCharge, saveConversionCharge, fetchIgstRate, saveIgstRate, fetchCnfCommissionRates, saveCnfCommissionRates } from '../../services/settlementService';
import { CnfCommissionRate } from '../../types';

export const ChargesConfig: React.FC = () => {
    const [chargePercent, setChargePercent] = useState<string>('0');
    const [savedPercent, setSavedPercent] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const [igstPercent, setIgstPercent] = useState<string>('5');
    const [savedIgstPercent, setSavedIgstPercent] = useState<number>(5);
    const [isIgstSaving, setIsIgstSaving] = useState(false);
    const [igstError, setIgstError] = useState<string | null>(null);
    const [igstSuccessMessage, setIgstSuccessMessage] = useState<string | null>(null);

    const [commissionRates, setCommissionRates] = useState<CnfCommissionRate[]>([]);
    const [isRatesLoading, setIsRatesLoading] = useState(true);
    const [isRatesSaving, setIsRatesSaving] = useState(false);
    const [ratesError, setRatesError] = useState<string | null>(null);
    const [ratesSuccessMessage, setRatesSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const [pct, igst] = await Promise.all([fetchConversionCharge(), fetchIgstRate()]);
                setChargePercent(String(pct));
                setSavedPercent(pct);
                setIgstPercent(String(igst));
                setSavedIgstPercent(igst);
            } catch {
                setError('Could not load current conversion charge % or IGST %. Defaulting to 0 and 5 respectively.');
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const rates = await fetchCnfCommissionRates();
                setCommissionRates(rates);
            } catch {
                setRatesError('Could not load commission rates.');
            } finally {
                setIsRatesLoading(false);
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

    const igstParsed = parseFloat(igstPercent);
    const isIgstValid = !isNaN(igstParsed) && igstParsed >= 0;
    const hasIgstChanges = isIgstValid && igstParsed !== savedIgstPercent;

    const handleSaveIgst = async () => {
        if (!isIgstValid) return;
        setIsIgstSaving(true);
        setIgstError(null);
        setIgstSuccessMessage(null);
        try {
            const saved = await saveIgstRate(igstParsed);
            setSavedIgstPercent(saved);
            setIgstPercent(String(saved));
            setIgstSuccessMessage('IGST % updated. Applies to CNF entries logged from now on.');
        } catch (err: any) {
            setIgstError(err.message || 'Failed to save IGST %.');
        } finally {
            setIsIgstSaving(false);
        }
    };

    const handleAddRateRow = () => {
        setCommissionRates(prev => [...prev, { id: `TMP-${Date.now()}-${Math.random()}`, label: '', ratePct: 0 }]);
    };

    const handleUpdateRateRow = (index: number, fields: Partial<CnfCommissionRate>) => {
        setCommissionRates(prev => prev.map((row, i) => (i === index ? { ...row, ...fields } : row)));
    };

    const handleRemoveRateRow = (index: number) => {
        setCommissionRates(prev => prev.filter((_, i) => i !== index));
    };

    const isRatesValid = commissionRates.every(r => r.label.trim().length > 0 && r.ratePct >= 0);

    const handleSaveRates = async () => {
        if (!isRatesValid) return;
        setIsRatesSaving(true);
        setRatesError(null);
        setRatesSuccessMessage(null);
        try {
            const saved = await saveCnfCommissionRates(commissionRates);
            setCommissionRates(saved);
            setRatesSuccessMessage('Commission rates updated.');
        } catch (err: any) {
            setRatesError(err.message || 'Failed to save commission rates.');
        } finally {
            setIsRatesSaving(false);
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

            <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">IGST</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    The IGST percentage applied to a CNF agent commission entry's Taxable Amount (Goods Value + Charges + Shipping Amount) to compute the Total payable to the agent.
                </p>
            </div>

            <Card>
                {isLoading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading current setting…</p>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="igst-pct" className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                                IGST %
                            </label>
                            <div className="flex items-center gap-2 max-w-xs">
                                <input
                                    id="igst-pct"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={igstPercent}
                                    onChange={e => { setIgstPercent(e.target.value); setIgstSuccessMessage(null); }}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition"
                                />
                                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">%</span>
                            </div>
                            {!isIgstValid && (
                                <p className="text-xs text-red-500 mt-1.5">Enter a non-negative number.</p>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            <Button onClick={handleSaveIgst} disabled={!isIgstValid || !hasIgstChanges || isIgstSaving}>
                                {isIgstSaving ? 'Saving…' : 'Save'}
                            </Button>
                            <span className="text-xs text-slate-400">Currently applied: {savedIgstPercent}%</span>
                        </div>

                        {igstError && <p className="text-sm text-red-500">{igstError}</p>}
                        {igstSuccessMessage && <p className="text-sm text-emerald-600 dark:text-emerald-400">{igstSuccessMessage}</p>}
                    </div>
                )}
            </Card>

            <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">CNF Commission Rates</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Commission rate % by product category, used to pre-fill Charges % on a CNF ledger entry. Add a row for each category you bill differently.
                </p>
            </div>

            <Card>
                {isRatesLoading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading commission rates…</p>
                ) : (
                    <div className="space-y-3">
                        {commissionRates.map((rate, index) => (
                            <div key={rate.id} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder="Category label, e.g. Wooden Toys"
                                    value={rate.label}
                                    onChange={e => handleUpdateRateRow(index, { label: e.target.value })}
                                    className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition"
                                />
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="Rate %"
                                    value={rate.ratePct}
                                    onChange={e => handleUpdateRateRow(index, { ratePct: parseFloat(e.target.value) || 0 })}
                                    className="w-28 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition"
                                />
                                <span className="text-sm text-slate-400">%</span>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveRateRow(index)}
                                    className="text-red-500 hover:text-red-600 text-xs font-bold px-2"
                                    title="Remove row"
                                >
                                    Remove
                                </button>
                            </div>
                        ))}

                        <button
                            type="button"
                            onClick={handleAddRateRow}
                            className="text-primary-500 hover:text-primary-600 text-xs font-bold"
                        >
                            + Add category
                        </button>

                        <div className="flex items-center gap-3 pt-2">
                            <Button onClick={handleSaveRates} disabled={!isRatesValid || isRatesSaving}>
                                {isRatesSaving ? 'Saving…' : 'Save Rates'}
                            </Button>
                        </div>

                        {!isRatesValid && (
                            <p className="text-xs text-red-500">Every category needs a non-empty label and a non-negative rate.</p>
                        )}
                        {ratesError && <p className="text-sm text-red-500">{ratesError}</p>}
                        {ratesSuccessMessage && <p className="text-sm text-emerald-600 dark:text-emerald-400">{ratesSuccessMessage}</p>}
                    </div>
                )}
            </Card>
        </div>
    );
};
