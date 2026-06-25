import React, { useState, useEffect, useCallback } from 'react';
import { APPS_SCRIPT_URL } from '../../constants';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
    ArrowPathIcon, 
    InformationCircleIcon, 
    CheckIcon, 
    XMarkIcon,
    ChartBarIcon,
    ShipIcon,
    AirplaneIcon,
    PresentationChartLineIcon
} from '../icons/Icons';

// Note: ShieldCheckIcon and ArrowsRightLeftIcon were not in the viewed Icons.tsx, 
// I will use fallback icons or define them if needed. 
// Looking at Icons.tsx again, I'll use CheckBadgeIcon for Shield and ArrowsUpDownIcon for Routing.

import { 
    CheckBadgeIcon,
    ArrowsUpDownIcon
} from '../icons/Icons';

interface ForecastingConfigData {
  // Transit & Lead Times
  SEA_TRANSIT_DAYS: number;
  AIR_TRANSIT_DAYS: number;
  PROTECTION_DAYS_B2B_SEA: number;
  PROTECTION_DAYS_B2B_AIR: number;
  // Buffer & Cover
  BUFFER_SEA: number;
  BUFFER_AIR: number;
  FREQUENCY_SEA: number;
  FREQUENCY_AIR: number;
  BULK_PERCENTILE: number;
  // Demand Calculation
  SALES_HISTORY_DAYS: number;
  ADS_WEIGHT_15D: number;
  ADS_WEIGHT_30D: number;
  ADS_WEIGHT_60D: number;
  ADS_WEIGHT_90D: number;
  LOW_VELOCITY_FLOOR: number;
  B2B_MULTIPLIER: number;
  SERVICE_LEVEL_Z: number;
  // SKU Routing
  MIN_COST_AIR: number;
  LOW_MMA_AIR: number;
}

type SectionKey = 'transit' | 'buffer' | 'demand' | 'routing';

const DEFAULTS: ForecastingConfigData = {
  SEA_TRANSIT_DAYS: 60,
  AIR_TRANSIT_DAYS: 20,
  PROTECTION_DAYS_B2B_SEA: 20,
  PROTECTION_DAYS_B2B_AIR: 10,
  BUFFER_SEA: 45,
  BUFFER_AIR: 30,
  FREQUENCY_SEA: 15,
  FREQUENCY_AIR: 7,
  BULK_PERCENTILE: 75,
  SALES_HISTORY_DAYS: 90,
  ADS_WEIGHT_15D: 0.40,
  ADS_WEIGHT_30D: 0.30,
  ADS_WEIGHT_60D: 0.20,
  ADS_WEIGHT_90D: 0.10,
  LOW_VELOCITY_FLOOR: 0.3,
  B2B_MULTIPLIER: 1.2,
  SERVICE_LEVEL_Z: 1.65,
  MIN_COST_AIR: 500,
  LOW_MMA_AIR: 10,
};

const SECTION_FIELDS: Record<SectionKey, (keyof ForecastingConfigData)[]> = {
  transit: ['SEA_TRANSIT_DAYS', 'AIR_TRANSIT_DAYS', 'PROTECTION_DAYS_B2B_SEA', 'PROTECTION_DAYS_B2B_AIR'],
  buffer:  ['BUFFER_SEA', 'BUFFER_AIR', 'FREQUENCY_SEA', 'FREQUENCY_AIR', 'BULK_PERCENTILE'],
  demand:  ['SALES_HISTORY_DAYS', 'ADS_WEIGHT_15D', 'ADS_WEIGHT_30D', 'ADS_WEIGHT_60D', 'ADS_WEIGHT_90D', 'LOW_VELOCITY_FLOOR', 'B2B_MULTIPLIER', 'SERVICE_LEVEL_Z'],
  routing: ['MIN_COST_AIR', 'LOW_MMA_AIR'],
};

interface DebugEntry {
    time: string;
    type: 'req' | 'res' | 'err';
    data: any;
}

export const ForecastingConfig: React.FC = () => {
    const [config, setConfig] = useState<ForecastingConfigData>(DEFAULTS);
    const [savedConfig, setSavedConfig] = useState<ForecastingConfigData>(DEFAULTS);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);

    const [sectionStates, setSectionStates] = useState<Record<SectionKey, {
        isSaving: boolean;
        isSaved: boolean;
        hasChanges: boolean;
    }>>({
        transit: { isSaving: false, isSaved: false, hasChanges: false },
        buffer:  { isSaving: false, isSaved: false, hasChanges: false },
        demand:  { isSaving: false, isSaved: false, hasChanges: false },
        routing: { isSaving: false, isSaved: false, hasChanges: false },
    });

    const addDebugLog = useCallback((type: 'req' | 'res' | 'err', data: any) => {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
        setDebugLog(prev => [{ time, type, data }, ...prev].slice(0, 20));
    }, []);

    const fetchConfig = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        addDebugLog('req', { action: 'get_forecasting_config' });

        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'get_forecasting_config' })
            });
            const data = await response.json();
            addDebugLog('res', data);

            if (data.success && data.config) {
                const mergedConfig = { ...DEFAULTS, ...data.config };
                setConfig(mergedConfig);
                setSavedConfig(mergedConfig);
            } else {
                setLoadError("Using defaults (backend data missing or error)");
            }
        } catch (err: any) {
            addDebugLog('err', err.message);
            setLoadError("Using defaults (connection error)");
        } finally {
            setIsLoading(false);
        }
    }, [addDebugLog]);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    // Update hasChanges when config or savedConfig changes
    useEffect(() => {
        const newStates = { ...sectionStates };
        let changed = false;
        (Object.keys(SECTION_FIELDS) as SectionKey[]).forEach(section => {
            const fields = SECTION_FIELDS[section];
            const hasChanges = fields.some(f => config[f] !== savedConfig[f]);
            if (newStates[section].hasChanges !== hasChanges) {
                newStates[section] = { ...newStates[section], hasChanges };
                changed = true;
            }
        });
        if (changed) setSectionStates(newStates);
    }, [config, savedConfig]);

    const handleInputChange = (field: keyof ForecastingConfigData, value: number) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    const saveSection = async (section: SectionKey) => {
        setSectionStates(prev => ({ ...prev, [section]: { ...prev[section], isSaving: true } }));
        
        const fields = SECTION_FIELDS[section];
        const sectionData: Partial<ForecastingConfigData> = {};
        fields.forEach(f => {
            sectionData[f] = config[f];
        });

        addDebugLog('req', { action: 'save_forecasting_config', config: sectionData });

        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'save_forecasting_config', config: sectionData })
            });
            const data = await response.json();
            addDebugLog('res', data);

            if (data.success) {
                setSavedConfig(prev => ({ ...prev, ...sectionData }));
                setSectionStates(prev => ({ 
                    ...prev, 
                    [section]: { ...prev[section], isSaving: false, isSaved: true, hasChanges: false } 
                }));
                setTimeout(() => {
                    setSectionStates(prev => ({ ...prev, [section]: { ...prev[section], isSaved: false } }));
                }, 3000);
            } else {
                throw new Error(data.message || "Save failed");
            }
        } catch (err: any) {
            addDebugLog('err', err.message);
            setSectionStates(prev => ({ ...prev, [section]: { ...prev[section], isSaving: false } }));
            alert(`Failed to save ${section} settings: ${err.message}`);
        }
    };

    const resetSection = (section: SectionKey) => {
        const fields = SECTION_FIELDS[section];
        const resetData: Partial<ForecastingConfigData> = {};
        fields.forEach(f => {
            resetData[f] = savedConfig[f];
        });
        setConfig(prev => ({ ...prev, ...resetData }));
    };

    const adsTotal = config.ADS_WEIGHT_15D + config.ADS_WEIGHT_30D + config.ADS_WEIGHT_60D + config.ADS_WEIGHT_90D;
    const isAdsValid = Math.abs(adsTotal - 1.0) < 0.001;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <ArrowPathIcon className="w-8 h-8 text-blue-500 animate-spin" />
                <p className="text-slate-400 text-sm font-medium">Loading forecasting configuration...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-base font-bold text-slate-800 dark:text-white">Forecasting Configuration</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Settings are saved to the <span className="text-slate-700 dark:text-slate-300 font-mono">Forecasting_Config</span> sheet and take effect on the next forecast run.
                    </p>
                    {loadError && (
                        <div className="mt-2 flex items-center gap-2 text-yellow-400 text-[10px] font-bold uppercase tracking-wider">
                            <InformationCircleIcon className="w-3 h-3" />
                            {loadError}
                        </div>
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
                    <button 
                        onClick={() => setShowDebug(!showDebug)}
                        className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border ${
                            showDebug 
                            ? 'bg-purple-600/20 text-purple-600 dark:text-purple-400 border-purple-500/30' 
                            : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                        }`}
                    >
                        🐛 Debug
                    </button>
                </div>
            </div>

            {/* Debug Panel */}
            {showDebug && (
                <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-purple-500/30 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">API Activity Log</h3>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => {
                                    navigator.clipboard.writeText(JSON.stringify(debugLog, null, 2));
                                }}
                                className="text-[9px] text-slate-400 hover:text-white underline underline-offset-2"
                            >
                                Copy JSON
                            </button>
                            <button 
                                onClick={() => setDebugLog([])}
                                className="text-[9px] text-slate-400 hover:text-white underline underline-offset-2"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto font-mono text-[10px]">
                        {debugLog.length === 0 ? (
                            <p className="text-slate-600 italic py-4 text-center">No API calls yet.</p>
                        ) : (
                            debugLog.map((entry, i) => (
                                <div key={i} className="flex gap-3 items-start border-b border-slate-800 pb-2 last:border-0">
                                    <span className="text-slate-500 flex-shrink-0">{entry.time}</span>
                                    <span className={`px-1 rounded flex-shrink-0 font-bold ${
                                        entry.type === 'req' ? 'bg-blue-500/10 text-blue-400' :
                                        entry.type === 'res' ? 'bg-green-500/10 text-green-400' :
                                        'bg-red-500/10 text-red-400'
                                    }`}>
                                        {entry.type.toUpperCase()}
                                    </span>
                                    <span className="text-slate-400 break-all">{JSON.stringify(entry.data)}</span>
                                </div>
                            ))
                        )}
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 gap-6">
                {/* Section 1: Transit & Lead Times */}
                <SectionCard 
                    title="Transit & Lead Times" 
                    subtitle="Define logistics delays for each shipping mode"
                    icon={<ShipIcon className="w-5 h-5 text-blue-400" />}
                    state={sectionStates.transit}
                    onSave={() => saveSection('transit')}
                    onReset={() => resetSection('transit')}
                >
                    <SettingRow 
                        label="SEA Transit Days"
                        description="Days from supplier dispatch to India arrival via sea. Added on top of Lead_Time from EE Product Master."
                        unit="days"
                        value={config.SEA_TRANSIT_DAYS}
                        onChange={(v) => handleInputChange('SEA_TRANSIT_DAYS', v)}
                    />
                    <SettingRow 
                        label="AIR Transit Days"
                        description="Total lead time for AIR mode (production + air freight)."
                        unit="days"
                        value={config.AIR_TRANSIT_DAYS}
                        onChange={(v) => handleInputChange('AIR_TRANSIT_DAYS', v)}
                    />
                    <SettingRow 
                        label="B2B Protection Days (SEA)"
                        description="Multiplied with B2B safety stock for SEA."
                        unit="days"
                        tag="B2B · SEA"
                        value={config.PROTECTION_DAYS_B2B_SEA}
                        onChange={(v) => handleInputChange('PROTECTION_DAYS_B2B_SEA', v)}
                    />
                    <SettingRow 
                        label="B2B Protection Days (AIR)"
                        description="Multiplied with B2B safety stock for AIR. Reserved for future use."
                        unit="days"
                        tag="B2B · AIR"
                        value={config.PROTECTION_DAYS_B2B_AIR}
                        onChange={(v) => handleInputChange('PROTECTION_DAYS_B2B_AIR', v)}
                    />
                </SectionCard>

                {/* Section 2: Buffer Stock & Cover */}
                <SectionCard 
                    title="Buffer Stock & Cover" 
                    subtitle="Safety margins to prevent stockouts"
                    icon={<CheckBadgeIcon className="w-5 h-5 text-emerald-400" />}
                    state={sectionStates.buffer}
                    onSave={() => saveSection('buffer')}
                    onReset={() => resetSection('buffer')}
                >
                    <SettingRow 
                        label="SEA Minimum Cover Buffer"
                        description="Minimum days of cover required when a SEA shipment arrives. Drives target stock upward."
                        unit="days"
                        value={config.BUFFER_SEA}
                        onChange={(v) => handleInputChange('BUFFER_SEA', v)}
                    />
                    <SettingRow 
                        label="AIR Minimum Cover Buffer"
                        description="Minimum days of cover required when an AIR shipment arrives."
                        unit="days"
                        value={config.BUFFER_AIR}
                        onChange={(v) => handleInputChange('BUFFER_AIR', v)}
                    />
                    <SettingRow 
                        label="Order Frequency — SEA"
                        description="How often SEA orders are placed. Extra inventory = ADS × this."
                        unit="days"
                        value={config.FREQUENCY_SEA}
                        onChange={(v) => handleInputChange('FREQUENCY_SEA', v)}
                    />
                    <SettingRow 
                        label="Order Frequency — AIR"
                        description="How often AIR orders are placed. Extra inventory = ADS × this."
                        unit="days"
                        value={config.FREQUENCY_AIR}
                        onChange={(v) => handleInputChange('FREQUENCY_AIR', v)}
                    />
                    <SettingRow 
                        label="Bulk Order Percentile"
                        description="Percentile of BULK channel order sizes used for safety stock buffer. 75 = covers 75% of typical BULK orders. Outliers (>mean+2σ) are automatically excluded."
                        unit="%"
                        value={config.BULK_PERCENTILE}
                        min={50}
                        max={95}
                        step={5}
                        onChange={(v) => handleInputChange('BULK_PERCENTILE', v)}
                    />
                </SectionCard>

                {/* Section 3: Demand Calculation */}
                <SectionCard 
                    title="Demand Calculation" 
                    subtitle="Fine-tune how Average Daily Sales (ADS) is computed"
                    icon={<PresentationChartLineIcon className="w-5 h-5 text-purple-400" />}
                    state={sectionStates.demand}
                    onSave={() => saveSection('demand')}
                    onReset={() => resetSection('demand')}
                >
                    <SettingRow 
                        label="Sales History Window"
                        description="How many days back to look in Sales Data when computing ADS."
                        unit="days"
                        value={config.SALES_HISTORY_DAYS}
                        onChange={(v) => handleInputChange('SALES_HISTORY_DAYS', v)}
                    />
                    <SettingRow 
                        label="Low Velocity Floor"
                        description="Any SKU with B2C ADS below this is bumped to this floor. 0.3 ≈ 9 units/month."
                        unit="units/day"
                        value={config.LOW_VELOCITY_FLOOR}
                        step={0.1}
                        onChange={(v) => handleInputChange('LOW_VELOCITY_FLOOR', v)}
                    />
                    <SettingRow 
                        label="B2B Demand Multiplier"
                        description="B2B ADS is multiplied by this. Compounds with safety stock — use carefully."
                        unit="×"
                        tag="B2B"
                        value={config.B2B_MULTIPLIER}
                        step={0.1}
                        onChange={(v) => handleInputChange('B2B_MULTIPLIER', v)}
                    />
                    <SettingRow 
                        label="Service Level (Z-Score)"
                        description={`Z-score for B2C safety stock. Current: ${config.SERVICE_LEVEL_Z === 1.65 ? '95%' : config.SERVICE_LEVEL_Z === 1.96 ? '97.5%' : config.SERVICE_LEVEL_Z === 2.33 ? '99%' : config.SERVICE_LEVEL_Z === 1.28 ? '90%' : 'Custom'}`}
                        unit="—"
                        value={config.SERVICE_LEVEL_Z}
                        step={0.01}
                        onChange={(v) => handleInputChange('SERVICE_LEVEL_Z', v)}
                    />

                    {/* ADS Weights Sub-group */}
                    <div className="mt-6 pt-6 border-t border-slate-700/50">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-200">ADS Weights (B2C)</span>
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                    isAdsValid ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
                                }`}>
                                    Total = {adsTotal.toFixed(2)} {isAdsValid ? '✓' : '⚠ must equal 1.00'}
                                </span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <WeightInput 
                                label="Last 15 days" 
                                hint="Recent trend"
                                value={config.ADS_WEIGHT_15D}
                                onChange={(v) => handleInputChange('ADS_WEIGHT_15D', v)}
                            />
                            <WeightInput 
                                label="Last 30 days" 
                                hint="Monthly average"
                                value={config.ADS_WEIGHT_30D}
                                onChange={(v) => handleInputChange('ADS_WEIGHT_30D', v)}
                            />
                            <WeightInput 
                                label="30–60 days" 
                                hint="Historical baseline"
                                value={config.ADS_WEIGHT_60D}
                                onChange={(v) => handleInputChange('ADS_WEIGHT_60D', v)}
                            />
                            <WeightInput 
                                label="60–90 days" 
                                hint="Long-term trend"
                                value={config.ADS_WEIGHT_90D}
                                onChange={(v) => handleInputChange('ADS_WEIGHT_90D', v)}
                            />
                        </div>
                    </div>
                </SectionCard>

                {/* Section 4: SKU Routing */}
                <SectionCard 
                    title="SKU Routing" 
                    subtitle="Rules for auto-assigning Air vs Sea mode"
                    icon={<ArrowsUpDownIcon className="w-5 h-5 text-sky-400" />}
                    state={sectionStates.routing}
                    onSave={() => saveSection('routing')}
                    onReset={() => resetSection('routing')}
                >
                    <SettingRow 
                        label="Min Cost for AIR Eligibility"
                        description={`SKUs with Cost > ₹${config.MIN_COST_AIR} go to AIR mode.`}
                        unit="₹ / unit"
                        value={config.MIN_COST_AIR}
                        onChange={(v) => handleInputChange('MIN_COST_AIR', v)}
                    />
                    <SettingRow 
                        label="Low MMA Threshold (AIR)"
                        description={`SKUs with Monthly Moving Average < ${config.LOW_MMA_AIR} go to AIR regardless of cost.`}
                        unit="units/month"
                        value={config.LOW_MMA_AIR}
                        onChange={(v) => handleInputChange('LOW_MMA_AIR', v)}
                    />

                    <div className="mt-4 bg-slate-100/60 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/40 rounded-lg p-3 font-mono text-[11px] leading-relaxed">
                        <div className="flex items-center gap-2">
                            <span className="text-sky-600 dark:text-sky-400 font-bold">AIR</span>
                            <span className="text-slate-400 dark:text-slate-500">→</span>
                            <span className="text-slate-700 dark:text-slate-300">if Cost &gt; ₹{config.MIN_COST_AIR} OR Monthly Avg &lt; {config.LOW_MMA_AIR} units</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-blue-600 dark:text-blue-400 font-bold">SEA</span>
                            <span className="text-slate-400 dark:text-slate-500">→</span>
                            <span className="text-slate-700 dark:text-slate-300">if Cost ≤ ₹{config.MIN_COST_AIR} AND Monthly Avg ≥ {config.LOW_MMA_AIR} units</span>
                        </div>
                    </div>
                </SectionCard>
            </div>

            <p className="text-center text-slate-500 text-[11px] pt-4">
                After saving, go to the <span className="text-slate-400 font-semibold">Inventory Forecasting</span> tab and click <span className="text-slate-400 font-semibold italic">Refresh</span> to see the effect of your changes.
            </p>
        </div>
    );
};

// --- Sub-components ---

interface SectionCardProps {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    state: { isSaving: boolean; isSaved: boolean; hasChanges: boolean };
    onSave: () => void;
    onReset: () => void;
    children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({ title, subtitle, icon, state, onSave, onReset, children }) => (
    <Card className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-xl p-5 shadow-sm">
        <div className="flex items-start justify-between mb-6">
            <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                    {icon}
                </div>
                <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">{title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
                </div>
            </div>
            <div className="flex items-center gap-4">
                {state.hasChanges && (
                    <button 
                        onClick={onReset}
                        className="text-[10px] font-bold text-slate-500 hover:text-slate-300 uppercase tracking-widest transition-colors"
                    >
                        Reset
                    </button>
                )}
                <Button 
                    onClick={onSave}
                    disabled={!state.hasChanges || state.isSaving}
                    className={`h-8 px-4 text-[10px] font-bold uppercase tracking-widest transition-all ${
                        state.isSaved ? 'bg-green-105 dark:bg-green-650/25 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-600/30 hover:bg-green-100 dark:hover:bg-green-600/20 cursor-default' :
                        !state.hasChanges ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 cursor-not-allowed border-transparent' :
                        'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
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
        <div className="space-y-0">
            {children}
        </div>
    </Card>
);

interface SettingRowProps {
    label: string;
    description: string;
    unit: string;
    value: number;
    tag?: string;
    step?: number;
    min?: number;
    max?: number;
    onChange: (val: number) => void;
}

const SettingRow: React.FC<SettingRowProps> = ({ label, description, unit, value, tag, step = 1, min, max, onChange }) => (
    <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700/50 last:border-0 py-4">
        <div className="max-w-[70%]">
            <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</label>
                {tag && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-[8px] font-bold uppercase tracking-tighter border border-slate-200 dark:border-slate-600">
                        {tag}
                    </span>
                )}
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>
        </div>
        <div className="flex items-center gap-2">
            <input 
                type="number"
                value={value}
                step={step}
                min={min}
                max={max}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className="w-20 text-center text-sm font-semibold text-blue-600 dark:text-blue-300 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
            <span className="text-[10px] font-bold text-slate-450 dark:text-slate-600 uppercase w-12">{unit}</span>
        </div>
    </div>
);

interface WeightInputProps {
    label: string;
    hint: string;
    value: number;
    onChange: (val: number) => void;
}

const WeightInput: React.FC<WeightInputProps> = ({ label, hint, value, onChange }) => (
    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/40 rounded-lg p-3 flex items-center justify-between">
        <div>
            <p className="text-[11px] font-bold text-slate-800 dark:text-slate-300">{label}</p>
            <p className="text-[9px] text-slate-500 dark:text-slate-600 mt-0.5">{hint}</p>
        </div>
        <div className="flex items-center gap-2">
            <input 
                type="number"
                value={value}
                step={0.05}
                min={0}
                max={1}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className="w-16 text-center text-xs font-bold text-blue-600 dark:text-blue-300 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1 py-1 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 w-8">({Math.round(value * 100)}%)</span>
        </div>
    </div>
);
