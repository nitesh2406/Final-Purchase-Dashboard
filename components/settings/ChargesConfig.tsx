import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
    fetchConversionCharge, saveConversionCharge, fetchIgstRate, saveIgstRate,
    fetchCnfCommissionRates, saveCnfCommissionRates,
} from '../../services/settlementService';
import { fetchPartnerGstRate, savePartnerGstRate, fetchShippingPartners, saveShippingPartner } from '../../services/shippingPartnerService';
import { fetchCnfAirRate, saveCnfAirRate } from '../../services/cnfService';
import { CnfCommissionRate, ShippingPartner } from '../../types';

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

    // Shipping partner GST % (not KREIZ). null = not loaded (the save stays off
    // until a value is typed, so a failed load can't overwrite it with a default).
    const [partnerGst, setPartnerGst] = useState<string>('');
    const [savedPartnerGst, setSavedPartnerGst] = useState<number | null>(null);
    const [isPartnerGstLoading, setIsPartnerGstLoading] = useState(true);
    const [isPartnerGstSaving, setIsPartnerGstSaving] = useState(false);
    const [partnerGstError, setPartnerGstError] = useState<string | null>(null);
    const [partnerGstSuccess, setPartnerGstSuccess] = useState<string | null>(null);

    const [commissionRates, setCommissionRates] = useState<CnfCommissionRate[]>([]);
    const [isRatesLoading, setIsRatesLoading] = useState(true);
    const [isRatesSaving, setIsRatesSaving] = useState(false);
    const [ratesError, setRatesError] = useState<string | null>(null);
    const [ratesSuccessMessage, setRatesSuccessMessage] = useState<string | null>(null);

    // Air rate per shipping partner (₹/kg): KREIZ (a setting) + each partner
    // (its Shipping_Partners row). Inputs hold the typed strings; the saved
    // values tell which rows changed.
    const [kreizAirRate, setKreizAirRate] = useState<string>('');
    const [savedKreizAirRate, setSavedKreizAirRate] = useState<number | null>(null);
    const [airPartners, setAirPartners] = useState<ShippingPartner[]>([]);
    const [partnerRates, setPartnerRates] = useState<Record<string, string>>({});
    const [isAirRatesLoading, setIsAirRatesLoading] = useState(true);
    const [isAirRatesSaving, setIsAirRatesSaving] = useState(false);
    const [airRatesError, setAirRatesError] = useState<string | null>(null);
    const [airRatesSuccess, setAirRatesSuccess] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const [pct, igst] = await Promise.all([fetchConversionCharge(), fetchIgstRate()]);
                setChargePercent(String(pct));
                setSavedPercent(pct);
                setIgstPercent(String(igst));
                setSavedIgstPercent(igst);
            } catch {
                setError('Could not load current conversion charge % or CNF GST %. Defaulting to 0 and 5 respectively.');
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const pct = await fetchPartnerGstRate();
                setPartnerGst(String(pct));
                setSavedPartnerGst(pct);
            } catch {
                setPartnerGstError('Could not load the shipping partner GST %.');
            } finally {
                setIsPartnerGstLoading(false);
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

    const loadAirRates = async () => {
        setIsAirRatesLoading(true);
        const [kreiz, partners] = await Promise.allSettled([fetchCnfAirRate(), fetchShippingPartners()]);
        const problems: string[] = [];
        if (kreiz.status === 'fulfilled') {
            setSavedKreizAirRate(kreiz.value);
            setKreizAirRate(kreiz.value != null ? String(kreiz.value) : '');
        } else problems.push('the KREIZ air rate');
        if (partners.status === 'fulfilled') {
            setAirPartners(partners.value);
            setPartnerRates(Object.fromEntries(partners.value.map(p => [p.id, String(p.ratePerKg)])));
        } else problems.push('the shipping partners');
        setAirRatesError(problems.length ? `Could not load ${problems.join(' or ')}.` : null);
        setIsAirRatesLoading(false);
    };

    useEffect(() => { loadAirRates(); }, []);

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
            setIgstSuccessMessage('CNF GST % updated.');
        } catch (err: any) {
            setIgstError(err.message || 'Failed to save CNF GST %.');
        } finally {
            setIsIgstSaving(false);
        }
    };

    const partnerGstParsed = parseFloat(partnerGst);
    const isPartnerGstValid = partnerGst.trim() !== '' && !isNaN(partnerGstParsed) && partnerGstParsed >= 0;
    const hasPartnerGstChanges = isPartnerGstValid && partnerGstParsed !== savedPartnerGst;

    const handleSavePartnerGst = async () => {
        if (!isPartnerGstValid) return;
        setIsPartnerGstSaving(true);
        setPartnerGstError(null);
        setPartnerGstSuccess(null);
        try {
            const saved = await savePartnerGstRate(partnerGstParsed);
            setSavedPartnerGst(saved);
            setPartnerGst(String(saved));
            setPartnerGstSuccess('Shipping partner GST % updated.');
        } catch (err: any) {
            setPartnerGstError(err.message || 'Failed to save the shipping partner GST %.');
        } finally {
            setIsPartnerGstSaving(false);
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

    const rateOk = (v: string) => v.trim() !== '' && parseFloat(v) > 0;
    const kreizChanged = kreizAirRate.trim() !== '' && parseFloat(kreizAirRate) !== savedKreizAirRate;
    const changedPartners = airPartners.filter(p => (partnerRates[p.id] ?? '') !== String(p.ratePerKg));
    const airRatesValid = (!kreizChanged || rateOk(kreizAirRate)) && changedPartners.every(p => rateOk(partnerRates[p.id] ?? ''));
    const hasAirRateChanges = kreizChanged || changedPartners.length > 0;

    // Saves only the rows that changed: KREIZ's setting, and each partner
    // through save_shipping_partner with its other fields unchanged.
    const handleSaveAirRates = async () => {
        if (!airRatesValid || !hasAirRateChanges) return;
        setIsAirRatesSaving(true);
        setAirRatesError(null);
        setAirRatesSuccess(null);
        const failed: string[] = [];
        if (kreizChanged) {
            try { await saveCnfAirRate(parseFloat(kreizAirRate)); } catch (err: any) { failed.push(`KREIZ (${err.message || err})`); }
        }
        for (const p of changedPartners) {
            try {
                await saveShippingPartner({ id: p.id, name: p.name, gstin: p.gstin, ratePerKg: parseFloat(partnerRates[p.id]), active: p.active });
            } catch (err: any) { failed.push(`${p.name} (${err.message || err})`); }
        }
        await loadAirRates();
        if (failed.length) setAirRatesError(`Not saved: ${failed.join('; ')}`);
        else setAirRatesSuccess('Air rates updated. New draft invoices and partner bills use them.');
        setIsAirRatesSaving(false);
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
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">CNF GST</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    GST % CNF (KREIZ) charges on every tax invoice it raises, goods and ancillary. The CNF draft invoice and the CNF invoice checks use it.
                </p>
            </div>

            <Card>
                {isLoading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading current setting…</p>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="igst-pct" className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                                CNF GST %
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
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Shipping partner GST</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    GST % a shipping partner (not KREIZ) charges on its fee. The Log Partner Bill form fills GST from it, and bills that differ need an override reason.
                </p>
            </div>

            <Card>
                {isPartnerGstLoading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading current setting…</p>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="partner-gst-pct" className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                                Shipping partner GST %
                            </label>
                            <div className="flex items-center gap-2 max-w-xs">
                                <input
                                    id="partner-gst-pct"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={partnerGst}
                                    onChange={e => { setPartnerGst(e.target.value); setPartnerGstSuccess(null); }}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition"
                                />
                                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">%</span>
                            </div>
                            {partnerGst.trim() !== '' && !isPartnerGstValid && (
                                <p className="text-xs text-red-500 mt-1.5">Enter a non-negative number.</p>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            <Button aria-label="Save shipping partner GST" onClick={handleSavePartnerGst} disabled={!hasPartnerGstChanges || isPartnerGstSaving}>
                                {isPartnerGstSaving ? 'Saving…' : 'Save'}
                            </Button>
                            <span className="text-xs text-slate-400">Currently applied: {savedPartnerGst === null ? '—' : `${savedPartnerGst}%`}</span>
                        </div>

                        {partnerGstError && <p className="text-sm text-red-500">{partnerGstError}</p>}
                        {partnerGstSuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400">{partnerGstSuccess}</p>}
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

            <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Air rate per shipping partner</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    ₹ per kg each partner charges for an air batch. Choosing a batch's shipping partner fills its rate: KREIZ's goes into the CNF draft invoice, another partner's into its partner bill. Add partners on the Ledgers screen.
                </p>
            </div>

            <Card>
                {isAirRatesLoading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading air rates…</p>
                ) : (
                    <div className="space-y-3" data-testid="air-rates-card">
                        <div className="flex items-center gap-2">
                            <span className="flex-1 text-sm text-gray-900 dark:text-white">KREIZ <span className="text-xs text-slate-400">(CNF)</span></span>
                            <input
                                type="number" step="0.01" min="0" aria-label="KREIZ air rate" placeholder="Not set"
                                value={kreizAirRate}
                                onChange={e => { setKreizAirRate(e.target.value); setAirRatesSuccess(null); }}
                                className="w-32 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition"
                            />
                            <span className="text-sm text-slate-400 w-12">₹/kg</span>
                        </div>
                        {airPartners.map(p => (
                            <div key={p.id} className="flex items-center gap-2">
                                <span className="flex-1 text-sm text-gray-900 dark:text-white">
                                    {p.name} <span className="text-xs text-slate-400">({p.id}{p.active ? '' : ', inactive'})</span>
                                </span>
                                <input
                                    type="number" step="0.01" min="0" aria-label={`${p.name} air rate`}
                                    value={partnerRates[p.id] ?? ''}
                                    onChange={e => { const v = e.target.value; setPartnerRates(prev => ({ ...prev, [p.id]: v })); setAirRatesSuccess(null); }}
                                    className="w-32 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition"
                                />
                                <span className="text-sm text-slate-400 w-12">₹/kg</span>
                            </div>
                        ))}
                        {airPartners.length === 0 && !airRatesError && (
                            <p className="text-xs text-slate-400">No other shipping partners yet.</p>
                        )}

                        <div className="flex items-center gap-3 pt-2">
                            <Button aria-label="Save air rates" onClick={handleSaveAirRates} disabled={!airRatesValid || !hasAirRateChanges || isAirRatesSaving}>
                                {isAirRatesSaving ? 'Saving…' : 'Save Rates'}
                            </Button>
                        </div>

                        {!airRatesValid && <p className="text-xs text-red-500">Every changed rate must be above 0.</p>}
                        {airRatesError && <p className="text-sm text-red-500">{airRatesError}</p>}
                        {airRatesSuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400">{airRatesSuccess}</p>}
                    </div>
                )}
            </Card>
        </div>
    );
};
