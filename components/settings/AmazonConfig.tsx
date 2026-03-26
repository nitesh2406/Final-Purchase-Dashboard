import React, { useState, useEffect, useCallback } from 'react';
import { APPS_SCRIPT_URL } from '../../App';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
    ArrowPathIcon,
    InformationCircleIcon,
    CheckIcon,
    ChartBarIcon,
    PresentationChartLineIcon,
    CheckBadgeIcon,
    ArrowsUpDownIcon,
    ShoppingCartIcon,
} from '../icons/Icons';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AmazonConfigData {
    AMAZON_TARGET_DOC: number;
    AMAZON_DOC_THRESHOLD: number;
    AMAZON_MMA_FLOOR: number;
    AMAZON_MMA_MIN: number;
    AMAZON_SALES_HISTORY_DAYS: number;
    ADS_WEIGHT_15D: number;
    ADS_WEIGHT_30D: number;
    ADS_WEIGHT_60D: number;
    ADS_WEIGHT_90D: number;
    AMAZON_SLOW_MMA_MAX: number;
    AMAZON_FAST_MMA_MIN: number;
    AMAZON_ROUND_THRESHOLD: number;
    SHOPIFY_RESERVE_DAYS: number;
    AMAZON_STOCKOUT_SIGNAL_DAYS: number;
    AMAZON_OUTPUT_STORE_CODE: string;
}

type SectionKey = 'coverage' | 'mma' | 'velocity' | 'rounding' | 'output';

const DEFAULTS: AmazonConfigData = {
    AMAZON_TARGET_DOC: 57,
    AMAZON_DOC_THRESHOLD: 50,
    AMAZON_MMA_FLOOR: 5,
    AMAZON_MMA_MIN: 3,
    AMAZON_SALES_HISTORY_DAYS: 90,
    ADS_WEIGHT_15D: 0.40,
    ADS_WEIGHT_30D: 0.30,
    ADS_WEIGHT_60D: 0.20,
    ADS_WEIGHT_90D: 0.10,
    AMAZON_SLOW_MMA_MAX: 60,
    AMAZON_FAST_MMA_MIN: 120,
    AMAZON_ROUND_THRESHOLD: 30,
    SHOPIFY_RESERVE_DAYS: 30,
    AMAZON_STOCKOUT_SIGNAL_DAYS: 7,
    AMAZON_OUTPUT_STORE_CODE: 'ISK3',
};

const SECTION_FIELDS: Record<SectionKey, (keyof AmazonConfigData)[]> = {
    coverage: ['AMAZON_TARGET_DOC', 'AMAZON_DOC_THRESHOLD'],
    mma:      ['AMAZON_MMA_FLOOR', 'AMAZON_MMA_MIN', 'AMAZON_SALES_HISTORY_DAYS',
               'ADS_WEIGHT_15D', 'ADS_WEIGHT_30D', 'ADS_WEIGHT_60D', 'ADS_WEIGHT_90D'],
    velocity: ['AMAZON_SLOW_MMA_MAX', 'AMAZON_FAST_MMA_MIN'],
    rounding: ['AMAZON_ROUND_THRESHOLD'],
    output:   ['SHOPIFY_RESERVE_DAYS', 'AMAZON_STOCKOUT_SIGNAL_DAYS', 'AMAZON_OUTPUT_STORE_CODE'],
};

const SECTION_META: Record<SectionKey, { title: string; description: string; icon: React.ReactNode }> = {
    coverage: {
        title: 'Coverage Targets',
        description: 'Target and threshold DOC for FBA replenishment decisions',
        icon: <ChartBarIcon className="w-5 h-5 text-orange-400" />,
    },
    mma: {
        title: 'MMA Settings',
        description: '90-day weighted average calculation parameters',
        icon: <PresentationChartLineIcon className="w-5 h-5 text-purple-400" />,
    },
    velocity: {
        title: 'Velocity Bands',
        description: 'MMA thresholds for Slow / Medium / Fast SKU classification',
        icon: <ArrowsUpDownIcon className="w-5 h-5 text-sky-400" />,
    },
    rounding: {
        title: 'Rounding Rules',
        description: 'Quantity rounding thresholds for shipment planning',
        icon: <CheckBadgeIcon className="w-5 h-5 text-emerald-400" />,
    },
    output: {
        title: 'Reserve & Output Settings',
        description: 'Shopify reserve days, listing issue signal, store code',
        icon: <ShoppingCartIcon className="w-5 h-5 text-amber-400" />,
    },
};

const FIELD_META: Record<keyof AmazonConfigData, { label: string; description: string; unit: string; isString?: boolean }> = {
    AMAZON_TARGET_DOC:           { label: 'Target DOC',            description: 'Target days of FBA inventory coverage',                               unit: 'days' },
    AMAZON_DOC_THRESHOLD:        { label: 'DOC Threshold',          description: 'If current DOC exceeds this, send nothing',                          unit: 'days' },
    AMAZON_MMA_FLOOR:            { label: 'MMA Floor',              description: 'If calculated MMA < this, apply minimum',                            unit: 'units/mo' },
    AMAZON_MMA_MIN:              { label: 'MMA Minimum',            description: 'Minimum MMA value after floor check',                                unit: 'units/mo' },
    AMAZON_SALES_HISTORY_DAYS:   { label: 'Sales History',          description: 'Lookback window for MMA calculation',                                unit: 'days' },
    ADS_WEIGHT_15D:              { label: '0–15 Day Weight',        description: 'Weight for most recent 15-day bucket',                               unit: '' },
    ADS_WEIGHT_30D:              { label: '15–30 Day Weight',       description: 'Weight for 15–30 day bucket',                                        unit: '' },
    ADS_WEIGHT_60D:              { label: '30–60 Day Weight',       description: 'Weight for 30–60 day bucket',                                        unit: '' },
    ADS_WEIGHT_90D:              { label: '60–90 Day Weight',       description: 'Weight for 60–90 day bucket',                                        unit: '' },
    AMAZON_SLOW_MMA_MAX:         { label: 'Slow Band Max',          description: 'MMA ≤ this = slow velocity band',                                    unit: 'units/mo' },
    AMAZON_FAST_MMA_MIN:         { label: 'Fast Band Min',          description: 'MMA > this = fast velocity band',                                    unit: 'units/mo' },
    AMAZON_ROUND_THRESHOLD:      { label: 'Round Threshold',        description: 'qty < this → round to nearest 5; else round to nearest 10',          unit: 'units' },
    SHOPIFY_RESERVE_DAYS:        { label: 'Shopify Reserve',        description: 'Days of Shopify MMA stock to protect from Amazon allocation',        unit: 'days' },
    AMAZON_STOCKOUT_SIGNAL_DAYS: { label: 'Listing Issue Signal',   description: 'Flag listing issue if 0 sales for N days with MMA > 0',              unit: 'days' },
    AMAZON_OUTPUT_STORE_CODE:    { label: 'Store Code',             description: 'Store code written to Amazon_Shipment_Plan sheet',                   unit: '', isString: true },
};

interface DebugEntry { time: string; type: 'req' | 'res' | 'err'; data: any; }

// ─── Component ────────────────────────────────────────────────────────────────

export const AmazonConfig: React.FC<{
    externalConfig?: any;
    onRefreshExternal?: () => void;
    lastLoaded?: Date | null;
}> = ({ externalConfig, onRefreshExternal, lastLoaded }) => {

    const [config, setConfig] = useState<AmazonConfigData>(DEFAULTS);
    const [savedConfig, setSavedConfig] = useState<AmazonConfigData>(DEFAULTS);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);

    const [sectionStates, setSectionStates] = useState<Record<SectionKey, {
        isSaving: boolean; isSaved: boolean; hasChanges: boolean;
    }>>({
        coverage: { isSaving: false, isSaved: false, hasChanges: false },
        mma:      { isSaving: false, isSaved: false, hasChanges: false },
        velocity: { isSaving: false, isSaved: false, hasChanges: false },
        rounding: { isSaving: false, isSaved: false, hasChanges: false },
        output:   { isSaving: false, isSaved: false, hasChanges: false },
    });

    const addDebugLog = useCallback((type: 'req' | 'res' | 'err', data: any) => {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
        setDebugLog(prev => [{ time, type, data }, ...prev].slice(0, 20));
    }, []);

    // Sync from parent-loaded config
    useEffect(() => {
        if (externalConfig) {
            const merged = { ...DEFAULTS, ...externalConfig };
            setConfig(merged);
            setSavedConfig(merged);
            setIsLoading(false);
            setLoadError(null);
        } else if (!externalConfig && onRefreshExternal) {
            onRefreshExternal();
        }
    }, [externalConfig, onRefreshExternal]);

    // Fallback: fetch directly if parent never supplied config
    useEffect(() => {
        if (!externalConfig) {
            const timer = setTimeout(async () => {
                try {
                    const res = await fetch(APPS_SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({ action: 'get_amazon_config' }),
                    });
                    const data = await res.json();
                    if (data?.status === 'success' && data.config) {
                        const merged = { ...DEFAULTS, ...data.config };
                        setConfig(merged);
                        setSavedConfig(merged);
                        setLoadError(null);
                    } else {
                        setLoadError('Using defaults — backend config not found');
                        setConfig(DEFAULTS);
                        setSavedConfig(DEFAULTS);
                    }
                } catch {
                    setLoadError('Using defaults — could not reach backend');
                    setConfig(DEFAULTS);
                    setSavedConfig(DEFAULTS);
                } finally {
                    setIsLoading(false);
                }
            }, 400);
            return () => clearTimeout(timer);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Dirty state tracking
    useEffect(() => {
        const newStates = { ...sectionStates };
        let changed = false;
        (Object.keys(SECTION_FIELDS) as SectionKey[]).forEach(section => {
            const hasChanges = SECTION_FIELDS[section].some(f => config[f] !== savedConfig[f]);
            if (newStates[section].hasChanges !== hasChanges) {
                newStates[section] = { ...newStates[section], hasChanges };
                changed = true;
            }
        });
        if (changed) setSectionStates(newStates);
    }, [config, savedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleChange = (field: keyof AmazonConfigData, value: string | number) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    const resetSection = (section: SectionKey) => {
        const resetData: Partial<AmazonConfigData> = {};
        SECTION_FIELDS[section].forEach(f => { (resetData as any)[f] = savedConfig[f]; });
        setConfig(prev => ({ ...prev, ...resetData }));
    };

    const saveSection = async (section: SectionKey) => {
        setSectionStates(prev => ({ ...prev, [section]: { ...prev[section], isSaving: true } }));
        const sectionConfig: Partial<AmazonConfigData> = {};
        SECTION_FIELDS[section].forEach(field => { (sectionConfig as any)[field] = config[field]; });
        addDebugLog('req', { action: 'save_amazon_config', config: sectionConfig });
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'save_amazon_config', config: sectionConfig }),
            });
            const result = await response.json();
            addDebugLog('res', result);
            if (result.status === 'success') {
                setSavedConfig(prev => ({ ...prev, ...sectionConfig }));
                setSectionStates(prev => ({ ...prev, [section]: { isSaving: false, isSaved: true, hasChanges: false } }));
                setTimeout(() => setSectionStates(prev => ({ ...prev, [section]: { ...prev[section], isSaved: false } })), 3000);
                if (onRefreshExternal) onRefreshExternal();
            } else {
                throw new Error(result.message || 'Save failed');
            }
        } catch (err: any) {
            addDebugLog('err', err.message);
            setSectionStates(prev => ({ ...prev, [section]: { ...prev[section], isSaving: false } }));
            alert(`Failed to save: ${err.message}`);
        }
    };

    const adsTotal = config.ADS_WEIGHT_15D + config.ADS_WEIGHT_30D + config.ADS_WEIGHT_60D + config.ADS_WEIGHT_90D;
    const isAdsValid = Math.abs(adsTotal - 1.0) < 0.001;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <ArrowPathIcon className="w-8 h-8 text-orange-500 animate-spin" />
                <p className="text-slate-400 text-sm font-medium">Loading Amazon configuration...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-base font-bold text-white">Amazon FBA Configuration</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        Settings are saved to the <span className="text-slate-300 font-mono">Amazon_Config</span> sheet and take effect on the next forecast run.
                    </p>
                    {lastLoaded && (
                        <p className="text-[10px] text-slate-500 mt-1 italic">
                            Last loaded: {lastLoaded.toLocaleTimeString()} ({Math.floor((new Date().getTime() - lastLoaded.getTime()) / 60000)} mins ago)
                        </p>
                    )}
                    {loadError && (
                        <div className="mt-2 flex items-center gap-2 text-yellow-400 text-[10px] font-bold uppercase tracking-wider">
                            <InformationCircleIcon className="w-3 h-3" />
                            {loadError}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onRefreshExternal?.()}
                        className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
                        title="Reload from backend"
                    >
                        <ArrowPathIcon className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border ${showDebug
                            ? 'bg-purple-600/20 text-purple-400 border-purple-500/30'
                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600'
                        }`}
                    >
                        🐛 Debug
                    </button>
                </div>
            </div>

            {/* Debug Panel */}
            {showDebug && (
                <Card className="bg-slate-900 border-purple-500/30 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">API Activity Log</h3>
                        <div className="flex gap-2">
                            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(debugLog, null, 2))} className="text-[9px] text-slate-400 hover:text-white underline underline-offset-2">Copy JSON</button>
                            <button onClick={() => setDebugLog([])} className="text-[9px] text-slate-400 hover:text-white underline underline-offset-2">Clear</button>
                        </div>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto font-mono text-[10px]">
                        {debugLog.length === 0 ? (
                            <p className="text-slate-600 italic py-4 text-center">No API calls yet.</p>
                        ) : debugLog.map((entry, i) => (
                            <div key={i} className="flex gap-3 items-start border-b border-slate-800 pb-2 last:border-0">
                                <span className="text-slate-500 flex-shrink-0">{entry.time}</span>
                                <span className={`px-1 rounded flex-shrink-0 font-bold ${entry.type === 'req' ? 'bg-blue-500/10 text-blue-400' : entry.type === 'res' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                    {entry.type.toUpperCase()}
                                </span>
                                <span className="text-slate-400 break-all">{JSON.stringify(entry.data)}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 gap-6">
                {/* Coverage */}
                <AmazonSectionCard meta={SECTION_META.coverage} state={sectionStates.coverage} onSave={() => saveSection('coverage')} onReset={() => resetSection('coverage')}>
                    {SECTION_FIELDS.coverage.map(field => (
                        <AmazonSettingRow key={field} meta={FIELD_META[field]} value={config[field]} onChange={v => handleChange(field, v)} />
                    ))}
                </AmazonSectionCard>

                {/* MMA */}
                <AmazonSectionCard meta={SECTION_META.mma} state={sectionStates.mma} onSave={() => saveSection('mma')} onReset={() => resetSection('mma')}>
                    {(['AMAZON_MMA_FLOOR', 'AMAZON_MMA_MIN', 'AMAZON_SALES_HISTORY_DAYS'] as (keyof AmazonConfigData)[]).map(field => (
                        <AmazonSettingRow key={field} meta={FIELD_META[field]} value={config[field]} onChange={v => handleChange(field, v)} />
                    ))}
                    {/* ADS Weights sub-section */}
                    <div className="mt-6 pt-6 border-t border-slate-700/50">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-200">MMA Weights (per bucket)</span>
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${isAdsValid ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                                    Total = {adsTotal.toFixed(2)} {isAdsValid ? '✓' : '⚠ must equal 1.00'}
                                </span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {(['ADS_WEIGHT_15D', 'ADS_WEIGHT_30D', 'ADS_WEIGHT_60D', 'ADS_WEIGHT_90D'] as (keyof AmazonConfigData)[]).map(field => (
                                <div key={field} className="bg-slate-900/40 border border-slate-700/40 rounded-lg p-3 flex items-center justify-between">
                                    <div>
                                        <p className="text-[11px] font-bold text-slate-300">{FIELD_META[field].label}</p>
                                        <p className="text-[9px] text-slate-600 mt-0.5">{FIELD_META[field].description}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number" step={0.05} min={0} max={1}
                                            value={config[field] as number}
                                            onChange={e => handleChange(field, parseFloat(e.target.value) || 0)}
                                            className="w-16 text-center text-xs font-bold text-orange-300 bg-slate-800 border border-slate-700 rounded px-1 py-1 focus:ring-1 focus:ring-orange-500 outline-none"
                                        />
                                        <span className="text-[9px] font-mono text-slate-500 w-8">({Math.round((config[field] as number) * 100)}%)</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </AmazonSectionCard>

                {/* Velocity */}
                <AmazonSectionCard meta={SECTION_META.velocity} state={sectionStates.velocity} onSave={() => saveSection('velocity')} onReset={() => resetSection('velocity')}>
                    {SECTION_FIELDS.velocity.map(field => (
                        <AmazonSettingRow key={field} meta={FIELD_META[field]} value={config[field]} onChange={v => handleChange(field, v)} />
                    ))}
                    {/* Velocity band summary */}
                    <div className="mt-4 bg-slate-900/60 border border-slate-700/40 rounded-lg p-3 font-mono text-[11px] leading-relaxed">
                        <div className="flex items-center gap-2">
                            <span className="text-blue-400 font-bold">Slow</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-slate-300">MMA ≤ {config.AMAZON_SLOW_MMA_MAX} units/mo</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-amber-400 font-bold">Medium</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-slate-300">{config.AMAZON_SLOW_MMA_MAX} &lt; MMA ≤ {config.AMAZON_FAST_MMA_MIN} units/mo</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-green-400 font-bold">Fast</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-slate-300">MMA &gt; {config.AMAZON_FAST_MMA_MIN} units/mo</span>
                        </div>
                    </div>
                </AmazonSectionCard>

                {/* Rounding */}
                <AmazonSectionCard meta={SECTION_META.rounding} state={sectionStates.rounding} onSave={() => saveSection('rounding')} onReset={() => resetSection('rounding')}>
                    {SECTION_FIELDS.rounding.map(field => (
                        <AmazonSettingRow key={field} meta={FIELD_META[field]} value={config[field]} onChange={v => handleChange(field, v)} />
                    ))}
                    <div className="mt-4 bg-slate-900/60 border border-slate-700/40 rounded-lg p-3 font-mono text-[11px] leading-relaxed">
                        <div className="flex items-center gap-2">
                            <span className="text-slate-300">qty &lt; {config.AMAZON_ROUND_THRESHOLD}</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-orange-400 font-bold">round to nearest 5</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-slate-300">qty ≥ {config.AMAZON_ROUND_THRESHOLD}</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-orange-400 font-bold">round to nearest 10</span>
                        </div>
                    </div>
                </AmazonSectionCard>

                {/* Output */}
                <AmazonSectionCard meta={SECTION_META.output} state={sectionStates.output} onSave={() => saveSection('output')} onReset={() => resetSection('output')}>
                    {SECTION_FIELDS.output.map(field => (
                        <AmazonSettingRow key={field} meta={FIELD_META[field]} value={config[field]} onChange={v => handleChange(field, v)} />
                    ))}
                </AmazonSectionCard>
            </div>

            <p className="text-center text-slate-500 text-[11px] pt-4">
                After saving, go to the <span className="text-slate-400 font-semibold">Amazon Forecasting</span> tab and click <span className="text-slate-400 font-semibold italic">Refresh</span> to see the effect of your changes.
            </p>
        </div>
    );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface AmazonSectionCardProps {
    meta: { title: string; description: string; icon: React.ReactNode };
    state: { isSaving: boolean; isSaved: boolean; hasChanges: boolean };
    onSave: () => void;
    onReset: () => void;
    children: React.ReactNode;
}

const AmazonSectionCard: React.FC<AmazonSectionCardProps> = ({ meta, state, onSave, onReset, children }) => (
    <Card className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-5">
        <div className="flex items-start justify-between mb-6">
            <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                    {meta.icon}
                </div>
                <div>
                    <h3 className="text-sm font-bold text-white">{meta.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
                </div>
            </div>
            <div className="flex items-center gap-4">
                {state.hasChanges && (
                    <button onClick={onReset} className="text-[10px] font-bold text-slate-500 hover:text-slate-300 uppercase tracking-widest transition-colors">
                        Reset
                    </button>
                )}
                <Button
                    onClick={onSave}
                    disabled={!state.hasChanges || state.isSaving}
                    className={`h-8 px-4 text-[10px] font-bold uppercase tracking-widest transition-all ${
                        state.isSaved        ? 'bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/20 cursor-default' :
                        !state.hasChanges    ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed border-transparent' :
                                               'bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-900/20'
                    }`}
                >
                    {state.isSaving ? (
                        <div className="flex items-center gap-2">
                            <ArrowPathIcon className="w-3 h-3 animate-spin" />
                            Saving...
                        </div>
                    ) : state.isSaved ? (
                        <div className="flex items-center gap-2">
                            <CheckIcon className="w-3 h-3" />
                            Saved
                        </div>
                    ) : 'Save Changes'}
                </Button>
            </div>
        </div>
        <div className="space-y-0">{children}</div>
    </Card>
);

interface AmazonSettingRowProps {
    meta: { label: string; description: string; unit: string; isString?: boolean };
    value: string | number;
    onChange: (val: string | number) => void;
}

const AmazonSettingRow: React.FC<AmazonSettingRowProps> = ({ meta, value, onChange }) => (
    <div className="flex items-start justify-between border-b border-slate-700/50 last:border-0 py-4">
        <div className="max-w-[70%]">
            <label className="text-sm font-medium text-slate-200">{meta.label}</label>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{meta.description}</p>
        </div>
        <div className="flex items-center gap-2">
            {meta.isString ? (
                <input
                    type="text"
                    value={value as string}
                    onChange={e => onChange(e.target.value)}
                    className="w-20 text-center text-sm font-semibold text-orange-300 bg-slate-800 border border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-orange-500 outline-none transition-all"
                />
            ) : (
                <input
                    type="number"
                    value={value as number}
                    step={typeof value === 'number' && value < 1 ? 0.05 : 1}
                    min={0}
                    onChange={e => onChange(parseFloat(e.target.value) || 0)}
                    className="w-20 text-center text-sm font-semibold text-orange-300 bg-slate-800 border border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-orange-500 outline-none transition-all"
                />
            )}
            {meta.unit && (
                <span className="text-[10px] font-bold text-slate-600 uppercase w-16">{meta.unit}</span>
            )}
        </div>
    </div>
);
