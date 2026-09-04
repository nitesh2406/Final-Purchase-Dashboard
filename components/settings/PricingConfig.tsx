import React, { useState, useEffect, useCallback } from 'react';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../constants';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
    ArrowPathIcon,
    CheckIcon,
    BanknotesIcon,
} from '../icons/Icons';

// ─────────────────────────────────────────
// TYPES & DEFAULTS
// ─────────────────────────────────────────

interface PricingConfigData {
    // Core
    CNY_CONV_RATE: number;
    AIR_RATE: number;
    SEA_MULTIPLIER: number;
    THRESHOLD: number;
    PICK_PACK: number;
    SHOPIFY_COST_PCT: number;
    MIN_MARGIN_PCT: number;
    GST_RATE: number;
    // CM1 Target Brackets — used in the Raw SP formula
    CM1_BRACKET_0: number;
    CM1_BRACKET_250: number;
    CM1_BRACKET_500: number;
    CM1_BRACKET_1000: number;
    CM1_BRACKET_1500: number;
    CM1_BRACKET_2000: number;
    CM1_BRACKET_3000: number;
    CM1_BRACKET_4000: number;
    CM1_BRACKET_6000: number;
    // CM1 Floor Brackets — reference-only, rate-change monitoring
    CM1_FLOOR_BRACKET_0: number;
    CM1_FLOOR_BRACKET_250: number;
    CM1_FLOOR_BRACKET_500: number;
    CM1_FLOOR_BRACKET_1000: number;
    CM1_FLOOR_BRACKET_1500: number;
    CM1_FLOOR_BRACKET_2000: number;
    CM1_FLOOR_BRACKET_3000: number;
    CM1_FLOOR_BRACKET_4000: number;
    CM1_FLOOR_BRACKET_6000: number;
    // CM3 Target Brackets — reference-only, rate-change monitoring
    CM3_TARGET_BRACKET_0: number;
    CM3_TARGET_BRACKET_250: number;
    CM3_TARGET_BRACKET_500: number;
    CM3_TARGET_BRACKET_1000: number;
    CM3_TARGET_BRACKET_1500: number;
    CM3_TARGET_BRACKET_2000: number;
    CM3_TARGET_BRACKET_3000: number;
    CM3_TARGET_BRACKET_4000: number;
    CM3_TARGET_BRACKET_6000: number;
    // CM3 Floor Brackets — reference-only, rate-change monitoring
    CM3_FLOOR_BRACKET_0: number;
    CM3_FLOOR_BRACKET_250: number;
    CM3_FLOOR_BRACKET_500: number;
    CM3_FLOOR_BRACKET_1000: number;
    CM3_FLOOR_BRACKET_1500: number;
    CM3_FLOOR_BRACKET_2000: number;
    CM3_FLOOR_BRACKET_3000: number;
    CM3_FLOOR_BRACKET_4000: number;
    CM3_FLOOR_BRACKET_6000: number;
    // MRP Brackets — "Discount off MRP %" by Selling Price range
    MRP_BRACKET_0: number;
    MRP_BRACKET_501: number;
    MRP_BRACKET_1001: number;
    MRP_BRACKET_1501: number;
    MRP_BRACKET_2001: number;
    // Compare At Price Brackets — markup % by Selling Price range
    COMPARE_BRACKET_0: number;
    COMPARE_BRACKET_501: number;
    COMPARE_BRACKET_1501: number;
    COMPARE_BRACKET_3001: number;
    COMPARE_BRACKET_5001: number;
}

const DEFAULTS: PricingConfigData = {
    CNY_CONV_RATE: 14.5,
    AIR_RATE: 1.6,
    SEA_MULTIPLIER: 1.35,
    THRESHOLD: 40,
    PICK_PACK: 85,
    SHOPIFY_COST_PCT: 0.18,
    MIN_MARGIN_PCT: 20,
    GST_RATE: 0.05,
    CM1_BRACKET_0: 65,
    CM1_BRACKET_250: 55,
    CM1_BRACKET_500: 47,
    CM1_BRACKET_1000: 42,
    CM1_BRACKET_1500: 40,
    CM1_BRACKET_2000: 38,
    CM1_BRACKET_3000: 38,
    CM1_BRACKET_4000: 39,
    CM1_BRACKET_6000: 39,
    CM1_FLOOR_BRACKET_0: 60,
    CM1_FLOOR_BRACKET_250: 50,
    CM1_FLOOR_BRACKET_500: 42,
    CM1_FLOOR_BRACKET_1000: 38,
    CM1_FLOOR_BRACKET_1500: 37,
    CM1_FLOOR_BRACKET_2000: 35,
    CM1_FLOOR_BRACKET_3000: 35,
    CM1_FLOOR_BRACKET_4000: 36,
    CM1_FLOOR_BRACKET_6000: 36,
    CM3_TARGET_BRACKET_0: 34,
    CM3_TARGET_BRACKET_250: 28,
    CM3_TARGET_BRACKET_500: 24,
    CM3_TARGET_BRACKET_1000: 20,
    CM3_TARGET_BRACKET_1500: 19,
    CM3_TARGET_BRACKET_2000: 18,
    CM3_TARGET_BRACKET_3000: 18,
    CM3_TARGET_BRACKET_4000: 19,
    CM3_TARGET_BRACKET_6000: 20,
    CM3_FLOOR_BRACKET_0: 30,
    CM3_FLOOR_BRACKET_250: 25,
    CM3_FLOOR_BRACKET_500: 20,
    CM3_FLOOR_BRACKET_1000: 17,
    CM3_FLOOR_BRACKET_1500: 17,
    CM3_FLOOR_BRACKET_2000: 15,
    CM3_FLOOR_BRACKET_3000: 16,
    CM3_FLOOR_BRACKET_4000: 16,
    CM3_FLOOR_BRACKET_6000: 18,
    MRP_BRACKET_0: 40,
    MRP_BRACKET_501: 35,
    MRP_BRACKET_1001: 30,
    MRP_BRACKET_1501: 25,
    MRP_BRACKET_2001: 20,
    COMPARE_BRACKET_0: 15,
    COMPARE_BRACKET_501: 12,
    COMPARE_BRACKET_1501: 10,
    COMPARE_BRACKET_3001: 8,
    COMPARE_BRACKET_5001: 6,
};

type ConfigKey = keyof PricingConfigData;

// Landing-price floors shared by CM1 Target / CM1 Floor / CM3 Target / CM3
// Floor — all four are keyed off the same 9-bracket landing-price scheme.
const MARGIN_BRACKET_ROWS: { floor: string; suffix: string }[] = [
    { floor: '0',     suffix: '0' },
    { floor: '250',   suffix: '250' },
    { floor: '500',   suffix: '500' },
    { floor: '1,000', suffix: '1000' },
    { floor: '1,500', suffix: '1500' },
    { floor: '2,000', suffix: '2000' },
    { floor: '3,000', suffix: '3000' },
    { floor: '4,000', suffix: '4000' },
    { floor: '6,000', suffix: '6000' },
];

const bracketArrayToFlat = (
    arr: { floor: number; value: number }[] | undefined,
    prefix: string,
    fallback: PricingConfigData,
): Partial<PricingConfigData> => {
    const out: any = {};
    MARGIN_BRACKET_ROWS.forEach(({ suffix }) => {
        const key = `${prefix}${suffix}` as ConfigKey;
        out[key] = arr?.find(b => b.floor === Number(suffix))?.value ?? fallback[key];
    });
    return out;
};

// Maps the backend's nested/lowercase response shape (cny_conv_rate,
// cm1_brackets: [{floor,value}, ...]) to this component's flat uppercase
// shape. Shared by the direct fetch below and by the externalConfig sync
// effect, since App.tsx's cache stores the same raw backend shape.
function mapPricingResponse(d: any): PricingConfigData {
    // The bracket spreads below are built dynamically from a fixed list of 9
    // floors and are guaranteed to cover every key at runtime — cast needed
    // since TS can't prove that from a loop-built object.
    return ({
        CNY_CONV_RATE:      Number(d.cny_conv_rate)    || DEFAULTS.CNY_CONV_RATE,
        AIR_RATE:           Number(d.air_rate)          || DEFAULTS.AIR_RATE,
        SEA_MULTIPLIER:     Number(d.sea_multiplier)    || DEFAULTS.SEA_MULTIPLIER,
        THRESHOLD:          Number(d.threshold)         || DEFAULTS.THRESHOLD,
        PICK_PACK:          Number(d.pick_pack)         || DEFAULTS.PICK_PACK,
        SHOPIFY_COST_PCT:   Number(d.shopify_cost_pct)  || DEFAULTS.SHOPIFY_COST_PCT,
        MIN_MARGIN_PCT:     Number(d.min_margin_pct)    || DEFAULTS.MIN_MARGIN_PCT,
        GST_RATE:           d.gst_rate !== undefined && d.gst_rate !== null ? Number(d.gst_rate) : DEFAULTS.GST_RATE,
        ...bracketArrayToFlat(d.cm1_brackets,        'CM1_BRACKET_',        DEFAULTS),
        ...bracketArrayToFlat(d.cm1_floor_brackets,  'CM1_FLOOR_BRACKET_',  DEFAULTS),
        ...bracketArrayToFlat(d.cm3_target_brackets, 'CM3_TARGET_BRACKET_', DEFAULTS),
        ...bracketArrayToFlat(d.cm3_floor_brackets,  'CM3_FLOOR_BRACKET_',  DEFAULTS),
        // MRP brackets — value is "Discount off MRP %"
        MRP_BRACKET_0:    d.mrp_brackets?.find((b: any) => b.floor === 0)?.value    ?? DEFAULTS.MRP_BRACKET_0,
        MRP_BRACKET_501:  d.mrp_brackets?.find((b: any) => b.floor === 501)?.value  ?? DEFAULTS.MRP_BRACKET_501,
        MRP_BRACKET_1001: d.mrp_brackets?.find((b: any) => b.floor === 1001)?.value ?? DEFAULTS.MRP_BRACKET_1001,
        MRP_BRACKET_1501: d.mrp_brackets?.find((b: any) => b.floor === 1501)?.value ?? DEFAULTS.MRP_BRACKET_1501,
        MRP_BRACKET_2001: d.mrp_brackets?.find((b: any) => b.floor === 2001)?.value ?? DEFAULTS.MRP_BRACKET_2001,
        // Compare brackets — markup %
        COMPARE_BRACKET_0:    d.compare_brackets?.find((b: any) => b.floor === 0)?.value    ?? DEFAULTS.COMPARE_BRACKET_0,
        COMPARE_BRACKET_501:  d.compare_brackets?.find((b: any) => b.floor === 501)?.value  ?? DEFAULTS.COMPARE_BRACKET_501,
        COMPARE_BRACKET_1501: d.compare_brackets?.find((b: any) => b.floor === 1501)?.value ?? DEFAULTS.COMPARE_BRACKET_1501,
        COMPARE_BRACKET_3001: d.compare_brackets?.find((b: any) => b.floor === 3001)?.value ?? DEFAULTS.COMPARE_BRACKET_3001,
        COMPARE_BRACKET_5001: d.compare_brackets?.find((b: any) => b.floor === 5001)?.value ?? DEFAULTS.COMPARE_BRACKET_5001,
    } as PricingConfigData);
}

// ─────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────

export const PricingConfig: React.FC<{
    externalConfig?: any;
    onRefreshExternal?: () => void;
    lastLoaded?: Date | null;
}> = ({ externalConfig, onRefreshExternal, lastLoaded }) => {
    const [config, setConfig] = useState<PricingConfigData>(DEFAULTS);
    const [savedConfig, setSavedConfig] = useState<PricingConfigData>(DEFAULTS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSaved, setIsSaved] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);

    const hasChanges = (Object.keys(DEFAULTS) as ConfigKey[]).some(
        k => config[k] !== savedConfig[k]
    );

    // ─── Load from GAS ───
    const fetchConfig = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: API_ACTIONS.GET_PRICING_CONFIG }),
            });
            const result = await response.json();
            if (result.success) {
                const mapped = mapPricingResponse(result.data);
                setConfig(mapped);
                setSavedConfig(mapped);
            }
        } catch (err) {
            console.error('fetchPricingConfig error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Was unconditionally calling fetchConfig() on every mount — no App-level
    // cache existed for this screen at all (unlike ForecastingConfig/
    // AmazonConfig), so it refetched from scratch on every visit. Same
    // pattern as those two now: use the parent's cached config if present,
    // ask the parent to load it if not, and only hit the backend directly
    // (fallback below) if no parent config ever arrives.
    useEffect(() => {
        if (externalConfig) {
            const mapped = mapPricingResponse(externalConfig);
            setConfig(mapped);
            setSavedConfig(mapped);
            setIsLoading(false);
        } else if (!externalConfig && onRefreshExternal) {
            onRefreshExternal();
        }
    }, [externalConfig, onRefreshExternal]);

    useEffect(() => {
        if (!externalConfig) {
            fetchConfig();
        }
    }, [externalConfig, fetchConfig]);

    // ─── Save to GAS ───
    const handleSave = async () => {
        if (!hasChanges || isSaving) return;
        setIsSaving(true);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    // Was 'save_forecasting_config' — a copy-paste bug that
                    // silently wrote pricing keys into the unrelated
                    // Forecasting_Config sheet and never touched SKU_Config,
                    // the sheet this screen actually reads from. Every
                    // "successful" save was a no-op for its real purpose.
                    action: 'save_pricing_config',
                    config,
                }),
            });
            const result = await response.json();
            if (result.success) {
                setSavedConfig({ ...config });
                setIsSaved(true);
                setLastSaved(new Date());
                setTimeout(() => setIsSaved(false), 3000);
                onRefreshExternal?.(); // let the parent know its cached copy is stale (same pattern as AmazonConfig)
            } else {
                alert('Save failed: ' + (result.message || result.error));
            }
        } catch (err: any) {
            alert('Network error: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setConfig({ ...savedConfig });
    };

    const update = (key: ConfigKey, value: number) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    // ─── Loading state ───
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <ArrowPathIcon className="w-8 h-8 text-blue-500 animate-spin" />
                <p className="text-slate-400 text-sm font-medium">Loading pricing configuration...</p>
            </div>
        );
    }

    // ─── Render ───
    return (
        <div className="space-y-6 pb-12">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-base font-bold text-slate-800 dark:text-white">Pricing Configuration</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Controls landing cost calculation, margin targets, MRP and Compare At Price rules for new SKU creation.
                    </p>
                    {lastSaved && (
                        <p className="text-[10px] text-slate-500 mt-1 italic">
                            Last saved: {lastSaved.toLocaleTimeString()}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchConfig}
                        className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
                        title="Reload from backend"
                    >
                        <ArrowPathIcon className="w-4 h-4" />
                    </button>
                    {hasChanges && (
                        <button
                            onClick={handleReset}
                            className="text-[10px] font-bold text-slate-500 hover:text-slate-300 uppercase tracking-widest transition-colors"
                        >
                            Reset
                        </button>
                    )}
                    <Button
                        onClick={handleSave}
                        // Only the native `disabled` attribute while actually
                        // saving — Button's shared disabled:opacity-50 would
                        // otherwise halve the already-muted "no changes" gray,
                        // making it unreadable against the page background.
                        // The "no changes" case is inert via handleSave's own
                        // guard instead.
                        disabled={isSaving}
                        className={`h-8 px-4 text-[10px] font-bold uppercase tracking-widest transition-all ${
                            isSaved
                                ? 'bg-green-100 dark:bg-green-600/25 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-600/30 hover:bg-green-100 dark:hover:bg-green-600/20 cursor-default'
                                : !hasChanges
                                    // Unlike ForecastingConfig's per-section Save button (sits on a
                                    // white Card), this one sits directly on the page's bg-gray-100
                                    // shell — the same near-white fill would have no visible edge
                                    // there, so it gets an explicit border for definition.
                                    ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-600'
                                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                        }`}
                    >
                        {isSaving ? (
                            <div className="flex items-center gap-2">
                                <ArrowPathIcon className="w-3 h-3 animate-spin" />
                                Saving...
                            </div>
                        ) : isSaved ? (
                            <div className="flex items-center gap-2">
                                <CheckIcon className="w-3 h-3" />
                                Saved
                            </div>
                        ) : 'Save All Changes'}
                    </Button>
                </div>
            </div>

            {/* ─── Section 1: Core Pricing Variables ─── */}
            <Card className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-xl p-5 shadow-sm">
                <div className="flex gap-4 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                        <BanknotesIcon className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white">Core Pricing Variables</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Base rates and costs used for landing price and margin calculations</p>
                    </div>
                </div>
                <div className="space-y-0">
                    <SettingRow label="RMB → INR Rate" unit="—" value={config.CNY_CONV_RATE} step={0.01}
                        description="Fluctuates with the market — review periodically."
                        onChange={v => update('CNY_CONV_RATE', v)} />
                    <SettingRow label="Air Freight Rate" unit="₹ / gm" value={config.AIR_RATE} step={0.1}
                        onChange={v => update('AIR_RATE', v)} />
                    <SettingRow label="Sea Freight Multiplier" unit="×" value={config.SEA_MULTIPLIER} step={0.01}
                        onChange={v => update('SEA_MULTIPLIER', v)} />
                    <SettingRow label="AIR / SEA Threshold" unit="RMB ¥" value={config.THRESHOLD} step={1}
                        description="RMB price above this ships SEA; at or below ships AIR."
                        onChange={v => update('THRESHOLD', v)} />
                    <SettingRow label="Pick & Pack Fee" unit="₹ / unit" value={config.PICK_PACK} step={1}
                        onChange={v => update('PICK_PACK', v)} />
                    <SettingRow label="Shopify Cost %" unit="decimal" value={config.SHOPIFY_COST_PCT} step={0.01}
                        description="Store as decimal e.g. 0.18 = 18%"
                        onChange={v => update('SHOPIFY_COST_PCT', v)} />
                    <SettingRow label="GST Rate" unit="decimal" value={config.GST_RATE} step={0.01}
                        description="Store as decimal e.g. 0.05 = 5%. Applied to Raw SP."
                        onChange={v => update('GST_RATE', v)} />
                    <SettingRow label="Min Margin Warning" unit="%" value={config.MIN_MARGIN_PCT} step={1}
                        description="CM1% warning threshold shown while pricing a SKU — not used in any calculation."
                        onChange={v => update('MIN_MARGIN_PCT', v)} />
                </div>
            </Card>

            {/* ─── Section 2: Margin Brackets (CM1/CM3 Target & Floor) ─── */}
            <Card className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-xl p-5 shadow-sm">
                <div className="flex gap-4 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white">Margin Brackets</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Target &amp; Floor gross margin % by landing price range. Only <span className="font-semibold">CM1 Target</span> feeds the Raw SP formula — Floor columns and CM3 Target are reference thresholds for the rate-change monitoring workflow.
                        </p>
                    </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700/60">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">
                                <th className="text-left px-4 py-2.5 font-bold">Landing Price (₹)</th>
                                <th className="text-right px-4 py-2.5 font-bold">CM1 Target</th>
                                <th className="text-right px-4 py-2.5 font-bold">CM1 Floor</th>
                                <th className="text-right px-4 py-2.5 font-bold">CM3 Target</th>
                                <th className="text-right px-4 py-2.5 font-bold">CM3 Floor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {MARGIN_BRACKET_ROWS.map(({ floor, suffix }) => (
                                <tr key={suffix} className="border-t border-slate-200 dark:border-slate-700/40">
                                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 font-mono text-xs whitespace-nowrap">₹ {floor}</td>
                                    {([
                                        `CM1_BRACKET_${suffix}`,
                                        `CM1_FLOOR_BRACKET_${suffix}`,
                                        `CM3_TARGET_BRACKET_${suffix}`,
                                        `CM3_FLOOR_BRACKET_${suffix}`,
                                    ] as ConfigKey[]).map(key => (
                                        <td key={key} className="px-2 py-2.5 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <input
                                                    type="number"
                                                    value={config[key]}
                                                    step={1}
                                                    onChange={e => update(key, parseFloat(e.target.value) || 0)}
                                                    className="w-16 text-center text-sm font-semibold text-blue-600 dark:text-blue-300 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                                />
                                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600">%</span>
                                            </div>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* ─── Section 3: MRP Brackets ─── */}
            <Card className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-xl p-5 shadow-sm">
                <div className="flex gap-4 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white">MRP Brackets</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">MRP = Selling Price ÷ (1 − Discount %), by selling price range</p>
                    </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700/60">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">
                                <th className="text-left px-4 py-2.5 font-bold">Selling Price (₹)</th>
                                <th className="text-right px-4 py-2.5 font-bold">Discount off MRP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {([
                                { floor: '≤ 500',        key: 'MRP_BRACKET_0' as ConfigKey },
                                { floor: '501 – 1,000',  key: 'MRP_BRACKET_501' as ConfigKey },
                                { floor: '1,001 – 1,500',key: 'MRP_BRACKET_1001' as ConfigKey },
                                { floor: '1,501 – 2,000',key: 'MRP_BRACKET_1501' as ConfigKey },
                                { floor: '> 2,000',      key: 'MRP_BRACKET_2001' as ConfigKey },
                            ]).map(row => (
                                <tr key={row.key} className="border-t border-slate-200 dark:border-slate-700/40">
                                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 font-mono text-xs">{row.floor}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <input
                                                type="number"
                                                value={config[row.key]}
                                                step={1}
                                                onChange={e => update(row.key, parseFloat(e.target.value) || 0)}
                                                className="w-20 text-center text-sm font-semibold text-blue-600 dark:text-blue-300 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                            />
                                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600 w-4">%</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* ─── Section 4: Compare At Price Brackets ─── */}
            <Card className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-xl p-5 shadow-sm">
                <div className="flex gap-4 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white">Compare At Price Brackets</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Markup % added to selling price for the "Compare At" price on Shopify, capped at MRP</p>
                    </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700/60">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">
                                <th className="text-left px-4 py-2.5 font-bold">Selling Price (₹)</th>
                                <th className="text-right px-4 py-2.5 font-bold">Markup %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {([
                                { floor: '≤ 500',         key: 'COMPARE_BRACKET_0' as ConfigKey },
                                { floor: '501 – 1,500',   key: 'COMPARE_BRACKET_501' as ConfigKey },
                                { floor: '1,501 – 3,000', key: 'COMPARE_BRACKET_1501' as ConfigKey },
                                { floor: '3,001 – 5,000', key: 'COMPARE_BRACKET_3001' as ConfigKey },
                                { floor: '> 5,000',       key: 'COMPARE_BRACKET_5001' as ConfigKey },
                            ]).map(row => (
                                <tr key={row.key} className="border-t border-slate-200 dark:border-slate-700/40">
                                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 font-mono text-xs">{row.floor}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <input
                                                type="number"
                                                value={config[row.key]}
                                                step={1}
                                                onChange={e => update(row.key, parseFloat(e.target.value) || 0)}
                                                className="w-20 text-center text-sm font-semibold text-blue-600 dark:text-blue-300 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                            />
                                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600 w-4">%</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <p className="text-center text-slate-500 text-[11px] pt-4">
                After saving, new SKU pricing calculations will use the updated values immediately.
            </p>
        </div>
    );
};

// ─────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────

interface SettingRowProps {
    label: string;
    unit: string;
    value: number;
    step?: number;
    description?: string;
    onChange: (val: number) => void;
}

const SettingRow: React.FC<SettingRowProps> = ({ label, unit, value, step = 1, description, onChange }) => (
    <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700/50 last:border-0 py-4">
        <div className="max-w-[70%]">
            <label className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</label>
            {description && (
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>
            )}
        </div>
        <div className="flex items-center gap-2">
            <input
                type="number"
                value={value}
                step={step}
                onChange={e => onChange(parseFloat(e.target.value) || 0)}
                className="w-20 text-center text-sm font-semibold text-blue-600 dark:text-blue-300 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600 uppercase w-12">{unit}</span>
        </div>
    </div>
);
