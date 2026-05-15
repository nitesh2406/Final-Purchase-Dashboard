import React, { useState, useEffect, useCallback } from 'react';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../App';
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
    // CM1 Brackets
    CM1_BRACKET_0: number;
    CM1_BRACKET_500: number;
    CM1_BRACKET_1250: number;
    CM1_BRACKET_2000: number;
    CM1_BRACKET_4000: number;
    CM1_BRACKET_6000: number;
    // MRP Brackets
    MRP_BRACKET_0: number;
    MRP_BRACKET_1000: number;
    MRP_BRACKET_1500: number;
    MRP_BRACKET_2000: number;
    MRP_BRACKET_INF: number;
    // Compare Brackets
    COMPARE_BRACKET_0: number;
    COMPARE_BRACKET_1500: number;
    COMPARE_BRACKET_3000: number;
    COMPARE_BRACKET_5000: number;
    COMPARE_BRACKET_INF: number;
}

const DEFAULTS: PricingConfigData = {
    CNY_CONV_RATE: 14.36,
    AIR_RATE: 1.6,
    SEA_MULTIPLIER: 1.35,
    THRESHOLD: 40,
    PICK_PACK: 85,
    SHOPIFY_COST_PCT: 0.18,
    CM1_BRACKET_0: 47,
    CM1_BRACKET_500: 45,
    CM1_BRACKET_1250: 41,
    CM1_BRACKET_2000: 39,
    CM1_BRACKET_4000: 41,
    CM1_BRACKET_6000: 35,
    MRP_BRACKET_0: 0.6,
    MRP_BRACKET_1000: 0.65,
    MRP_BRACKET_1500: 0.7,
    MRP_BRACKET_2000: 0.75,
    MRP_BRACKET_INF: 0.8,
    COMPARE_BRACKET_0: 15,
    COMPARE_BRACKET_1500: 12,
    COMPARE_BRACKET_3000: 10,
    COMPARE_BRACKET_5000: 8,
    COMPARE_BRACKET_INF: 6,
};

type ConfigKey = keyof PricingConfigData;

// ─────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────

export const PricingConfig: React.FC = () => {
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
                const merged = { ...DEFAULTS, ...result.data };
                setConfig(merged);
                setSavedConfig(merged);
            }
        } catch (err) {
            console.error('fetchPricingConfig error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchConfig(); }, [fetchConfig]);

    // ─── Save to GAS ───
    const handleSave = async () => {
        setIsSaving(true);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'save_forecasting_config',
                    config,
                }),
            });
            const result = await response.json();
            if (result.success) {
                setSavedConfig({ ...config });
                setIsSaved(true);
                setLastSaved(new Date());
                setTimeout(() => setIsSaved(false), 3000);
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
                    <h2 className="text-base font-bold text-white">Pricing Configuration</h2>
                    <p className="text-xs text-slate-500 mt-1">
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
                        className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
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
                        disabled={!hasChanges || isSaving}
                        className={`h-8 px-4 text-[10px] font-bold uppercase tracking-widest transition-all ${
                            isSaved
                                ? 'bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/20 cursor-default'
                                : !hasChanges
                                    ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed border-transparent'
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
            <Card className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-5">
                <div className="flex gap-4 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                        <BanknotesIcon className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white">Core Pricing Variables</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Base rates and costs used for landing price and margin calculations</p>
                    </div>
                </div>
                <div className="space-y-0">
                    <SettingRow label="RMB → INR Rate" unit="—" value={config.CNY_CONV_RATE} step={0.01}
                        onChange={v => update('CNY_CONV_RATE', v)} />
                    <SettingRow label="Air Freight Rate" unit="₹ / gm" value={config.AIR_RATE} step={0.1}
                        onChange={v => update('AIR_RATE', v)} />
                    <SettingRow label="Sea Freight Multiplier" unit="×" value={config.SEA_MULTIPLIER} step={0.01}
                        onChange={v => update('SEA_MULTIPLIER', v)} />
                    <SettingRow label="AIR / SEA Threshold" unit="RMB ¥" value={config.THRESHOLD} step={1}
                        onChange={v => update('THRESHOLD', v)} />
                    <SettingRow label="Pick & Pack Fee" unit="₹ / unit" value={config.PICK_PACK} step={1}
                        onChange={v => update('PICK_PACK', v)} />
                    <SettingRow label="Shopify Cost %" unit="decimal" value={config.SHOPIFY_COST_PCT} step={0.01}
                        description="Store as decimal e.g. 0.18 = 18%"
                        onChange={v => update('SHOPIFY_COST_PCT', v)} />
                </div>
            </Card>

            {/* ─── Section 2: CM1 Target Brackets ─── */}
            <Card className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-5">
                <div className="flex gap-4 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white">CM1 Target Brackets</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Target gross margin % by landing price range</p>
                    </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-700/60">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-900/60 text-slate-400 text-[10px] uppercase tracking-wider">
                                <th className="text-left px-4 py-2.5 font-bold">From (₹)</th>
                                <th className="text-right px-4 py-2.5 font-bold">CM1 Target %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {([
                                { floor: '0', key: 'CM1_BRACKET_0' as ConfigKey },
                                { floor: '500', key: 'CM1_BRACKET_500' as ConfigKey },
                                { floor: '1,250', key: 'CM1_BRACKET_1250' as ConfigKey },
                                { floor: '2,000', key: 'CM1_BRACKET_2000' as ConfigKey },
                                { floor: '4,000', key: 'CM1_BRACKET_4000' as ConfigKey },
                                { floor: '6,000', key: 'CM1_BRACKET_6000' as ConfigKey },
                            ]).map(row => (
                                <tr key={row.key} className="border-t border-slate-700/40">
                                    <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">₹ {row.floor}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <input
                                                type="number"
                                                value={config[row.key]}
                                                step={1}
                                                onChange={e => update(row.key, parseFloat(e.target.value) || 0)}
                                                className="w-20 text-center text-sm font-semibold text-blue-300 bg-slate-800 border border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                            />
                                            <span className="text-[10px] font-bold text-slate-600 w-4">%</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* ─── Section 3: MRP Brackets ─── */}
            <Card className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-5">
                <div className="flex gap-4 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white">MRP Brackets</h3>
                        <p className="text-xs text-slate-500 mt-0.5">MRP = Selling Price ÷ Divisor, by selling price range</p>
                    </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-700/60">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-900/60 text-slate-400 text-[10px] uppercase tracking-wider">
                                <th className="text-left px-4 py-2.5 font-bold">From SP (₹)</th>
                                <th className="text-right px-4 py-2.5 font-bold">Divisor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {([
                                { floor: '0', key: 'MRP_BRACKET_0' as ConfigKey },
                                { floor: '1,000', key: 'MRP_BRACKET_1000' as ConfigKey },
                                { floor: '1,500', key: 'MRP_BRACKET_1500' as ConfigKey },
                                { floor: '2,000', key: 'MRP_BRACKET_2000' as ConfigKey },
                                { floor: '∞', key: 'MRP_BRACKET_INF' as ConfigKey },
                            ]).map(row => (
                                <tr key={row.key} className="border-t border-slate-700/40">
                                    <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">₹ {row.floor}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        <input
                                            type="number"
                                            value={config[row.key]}
                                            step={0.05}
                                            onChange={e => update(row.key, parseFloat(e.target.value) || 0)}
                                            className="w-20 text-center text-sm font-semibold text-blue-300 bg-slate-800 border border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* ─── Section 4: Compare At Price Brackets ─── */}
            <Card className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-5">
                <div className="flex gap-4 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white">Compare At Price Brackets</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Markup % added to selling price for the "Compare At" price on Shopify</p>
                    </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-700/60">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-900/60 text-slate-400 text-[10px] uppercase tracking-wider">
                                <th className="text-left px-4 py-2.5 font-bold">From SP (₹)</th>
                                <th className="text-right px-4 py-2.5 font-bold">Markup %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {([
                                { floor: '0', key: 'COMPARE_BRACKET_0' as ConfigKey },
                                { floor: '1,500', key: 'COMPARE_BRACKET_1500' as ConfigKey },
                                { floor: '3,000', key: 'COMPARE_BRACKET_3000' as ConfigKey },
                                { floor: '5,000', key: 'COMPARE_BRACKET_5000' as ConfigKey },
                                { floor: '∞', key: 'COMPARE_BRACKET_INF' as ConfigKey },
                            ]).map(row => (
                                <tr key={row.key} className="border-t border-slate-700/40">
                                    <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">₹ {row.floor}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <input
                                                type="number"
                                                value={config[row.key]}
                                                step={1}
                                                onChange={e => update(row.key, parseFloat(e.target.value) || 0)}
                                                className="w-20 text-center text-sm font-semibold text-blue-300 bg-slate-800 border border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                            />
                                            <span className="text-[10px] font-bold text-slate-600 w-4">%</span>
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
    <div className="flex items-start justify-between border-b border-slate-700/50 last:border-0 py-4">
        <div className="max-w-[70%]">
            <label className="text-sm font-medium text-slate-200">{label}</label>
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
                className="w-20 text-center text-sm font-semibold text-blue-300 bg-slate-800 border border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
            <span className="text-[10px] font-bold text-slate-600 uppercase w-12">{unit}</span>
        </div>
    </div>
);
