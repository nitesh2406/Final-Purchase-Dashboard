import React, { useState } from 'react';
import { ForecastingConfig } from './ForecastingConfig';
import { SystemPreferences } from './SystemPreferences';
import { ApprovalWorkflows } from './ApprovalWorkflows';
import { TaxConfiguration } from './TaxConfiguration';
import { FreightCosting } from './FreightCosting';
import { PaymentTerms } from './PaymentTerms';
import { 
    Cog6ToothIcon, 
    CheckBadgeIcon, 
    BanknotesIcon, 
    TruckIcon, 
    BuildingLibraryIcon,
    ChartBarIcon
} from '../icons/Icons';

type SettingsView = 'Forecasting Config' | 'System Preferences' | 'Approval Workflows' | 'Tax Configuration' | 'Freight Costing' | 'Payment Terms';

interface NavItem {
    name: SettingsView;
    icon: React.ReactNode;
    description: string;
    isLive?: boolean;
}

const settingsNav: NavItem[] = [
    { 
        name: 'Forecasting Config', 
        icon: <ChartBarIcon className="w-5 h-5" />, 
        description: 'Transit times, buffers, and demand weights',
        isLive: true
    },
    { 
        name: 'System Preferences', 
        icon: <Cog6ToothIcon className="w-5 h-5" />, 
        description: 'General app behavior and defaults'
    },
    { 
        name: 'Approval Workflows', 
        icon: <CheckBadgeIcon className="w-5 h-5" />, 
        description: 'PO and payment authorization rules'
    },
    { 
        name: 'Tax Configuration', 
        icon: <BanknotesIcon className="w-5 h-5" />, 
        description: 'GST, duties, and regional tax settings'
    },
    { 
        name: 'Freight Costing', 
        icon: <TruckIcon className="w-5 h-5" />, 
        description: 'Shipping rates and landing cost factors'
    },
    { 
        name: 'Payment Terms', 
        icon: <BuildingLibraryIcon className="w-5 h-5" />, 
        description: 'Vendor credit periods and methods'
    },
];

export const Settings: React.FC = () => {
    const [activeView, setActiveView] = useState<SettingsView>('Forecasting Config');

    const renderView = () => {
        switch (activeView) {
            case 'Forecasting Config':
                return <ForecastingConfig />;
            case 'System Preferences':
                return <SystemPreferences />;
            case 'Approval Workflows':
                return <ApprovalWorkflows />;
            case 'Tax Configuration':
                return <TaxConfiguration />;
            case 'Freight Costing':
                return <FreightCosting />;
            case 'Payment Terms':
                return <PaymentTerms />;
            default:
                return <ForecastingConfig />;
        }
    };

    return (
        <div className="flex flex-col md:flex-row gap-8 h-full p-6 bg-slate-900 min-h-screen">
            <aside className="w-full md:w-1/4 lg:w-1/5">
                <h2 className="text-lg font-bold mb-6 text-white tracking-tight">Settings</h2>
                <nav className="space-y-2">
                    {settingsNav.map(item => (
                        <button
                            key={item.name}
                            onClick={() => setActiveView(item.name)}
                            className={`w-full flex flex-col items-start gap-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 border group ${
                                activeView === item.name
                                ? 'bg-blue-600/10 text-white border-blue-500/30 shadow-lg shadow-blue-900/10'
                                : 'text-slate-400 border-transparent hover:bg-slate-800/60 hover:text-slate-200'
                            }`}
                        >
                            <div className="flex items-center gap-3 w-full">
                                <div className={`transition-colors ${activeView === item.name ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'}`}>
                                    {item.icon}
                                </div>
                                <span className="flex-1 text-left">{item.name}</span>
                                {item.isLive && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[8px] font-black uppercase tracking-widest border border-blue-500/20">
                                        Live
                                    </span>
                                )}
                            </div>
                            <span className={`text-[10px] ml-8 font-normal transition-opacity duration-200 ${
                                activeView === item.name ? 'text-slate-400 opacity-100' : 'text-slate-600 opacity-0 group-hover:opacity-100'
                            }`}>
                                {item.description}
                            </span>
                        </button>
                    ))}
                </nav>
            </aside>
            <main className="flex-1 bg-slate-900">
                <div className="max-w-4xl">
                    {renderView()}
                </div>
            </main>
        </div>
    );
};
