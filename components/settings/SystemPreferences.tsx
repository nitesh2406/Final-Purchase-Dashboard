
import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MOCK_USERS, MOCK_ROLES_PERMISSIONS, MOCK_NOTIFICATION_RULES } from '../../constants';

type PrefTab = 'General' | 'Notifications' | 'Data & Security' | 'Integrations' | 'User Management' | 'Import/Export';

export const SystemPreferences: React.FC = () => {
    const [activeTab, setActiveTab] = useState<PrefTab>('General');
    const [clearedStatus, setClearedStatus] = useState<string | null>(null);
    const [cacheStats, setCacheStats] = useState(() => {
        const invStr = localStorage.getItem('purchase_invoices_table');
        const payStr = localStorage.getItem('payment_logs_table');
        const setStr = localStorage.getItem('settlement_records_table');
        const eodTime = localStorage.getItem('last_eod_success_time');
        
        let invCount = 0;
        let payCount = 0;
        let setCount = 0;
        let eodActive = false;
        let eodRemaining = '';
        
        try { if (invStr) invCount = JSON.parse(invStr).length; } catch(e){}
        try { if (payStr) payCount = JSON.parse(payStr).length; } catch(e){}
        try { if (setStr) setCount = JSON.parse(setStr).length; } catch(e){}
        
        if (eodTime) {
            const diff = Date.now() - parseInt(eodTime, 10);
            if (diff < 10 * 60 * 1000) {
                eodActive = true;
                const secLeft = Math.ceil((10 * 60 * 1000 - diff) / 1000);
                const min = Math.floor(secLeft / 60);
                const sec = secLeft % 60;
                eodRemaining = `${min}m ${sec}s`;
            }
        }
        
        return { invCount, payCount, setCount, eodActive, eodRemaining };
    });

    const handleClearCache = () => {
        localStorage.removeItem('purchase_invoices_table');
        localStorage.removeItem('payment_logs_table');
        localStorage.removeItem('settlement_records_table');
        localStorage.removeItem('last_eod_success_time');
        localStorage.removeItem('vendor_shipment_draft');
        
        setCacheStats({
            invCount: 0,
            payCount: 0,
            setCount: 0,
            eodActive: false,
            eodRemaining: ''
        });
        
        setClearedStatus('Optimistic data and offline cache successfully cleared! Reloading to fetch raw Sheets data...');
        setTimeout(() => {
            window.location.reload();
        }, 1200);
    };

    const renderContent = () => {
        switch(activeTab) {
            case 'General': return (
                <div>
                    <h4 className="font-semibold mb-2 text-slate-800 dark:text-white">Organization Info</h4>
                    <div className="grid grid-cols-2 gap-4 text-slate-600 dark:text-slate-300">
                        <div>
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Company Name</label>
                            <input type="text" readOnly value="Cubelelo Logistics Private Limited" className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-white" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">HQ Location</label>
                            <input type="text" readOnly value="Bengaluru, Karnataka, India" className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-white" />
                        </div>
                    </div>
                </div>
            );
            case 'Data & Security': return (
                <div className="space-y-6">
                    <div>
                        <h4 className="font-semibold text-slate-800 dark:text-white mb-1">Optimistic UI Cache & Offline State</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Manage local offline caching used to ensure fast interaction. Clearing the cache forces immediate real-time fetch from the master Google Sheets spreadsheet.</p>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                            <span className="block text-xs text-slate-500 dark:text-slate-400">Total Purchase Invoices</span>
                            <span className="text-xl font-bold text-slate-800 dark:text-white font-mono">{cacheStats.invCount}</span>
                        </div>
                        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                            <span className="block text-xs text-slate-500 dark:text-slate-400">Cached Payment Logs</span>
                            <span className="text-xl font-bold text-slate-800 dark:text-white font-mono">{cacheStats.payCount}</span>
                        </div>
                        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                            <span className="block text-xs text-slate-500 dark:text-slate-400">Settlement Ledger Size</span>
                            <span className="text-xl font-bold text-slate-800 dark:text-white font-mono">{cacheStats.setCount}</span>
                        </div>
                        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                            <span className="block text-xs text-slate-500 dark:text-slate-400">EOD Safe Interval</span>
                            <span className="text-sm font-bold text-slate-800 dark:text-white font-mono flex items-center gap-1.5 mt-1">
                                {cacheStats.eodActive ? (
                                    <>
                                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                                        Locked ({cacheStats.eodRemaining})
                                    </>
                                ) : (
                                    <>
                                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                        Inactive (Idle)
                                    </>
                                )}
                            </span>
                        </div>
                    </div>

                    <div className="bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <span className="block text-sm font-semibold text-slate-800 dark:text-white">Reset Optimistic Storage</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">Wipes local database copies, draft orders, and 10-minute protective EOD delay.</span>
                        </div>
                        <button
                            onClick={handleClearCache}
                            className="bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs px-4 py-2.5 rounded-lg shadow-md transition-all duration-200"
                        >
                            Purge Cache & Fetch Hard Copy
                        </button>
                    </div>

                    {clearedStatus && (
                        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs animate-pulse">
                            {clearedStatus}
                        </div>
                    )}
                </div>
            );
            case 'User Management': return (
                 <div>
                    <h4 className="font-semibold mb-2">Users</h4>
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800"><tr>{['Name', 'Email', 'Role', 'Status', 'Last Login'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium uppercase">{h}</th>)}</tr></thead>
                            <tbody className="divide-y dark:divide-gray-700">
                                {MOCK_USERS.map(user => <tr key={user.id}>
                                    <td className="px-4 py-3 font-medium">{user.name}</td>
                                    <td className="px-4 py-3">{user.email}</td>
                                    <td className="px-4 py-3">{user.role}</td>
                                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${user.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{user.status}</span></td>
                                    <td className="px-4 py-3">{user.lastLogin}</td>
                                </tr>)}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
            default: return <p>This section is under construction.</p>
        }
    }

    return (
        <Card>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold">System Preferences</h3>
                    <p className="text-sm text-gray-500">General application settings and configurations.</p>
                </div>
            </div>
             <div className="flex border-b dark:border-gray-700 mb-6 overflow-x-auto">
                 {(['General', 'Notifications', 'Data & Security', 'Integrations', 'User Management', 'Import/Export'] as PrefTab[]).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${activeTab === tab ? 'border-b-2 border-primary-500 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>{tab}</button>
                ))}
            </div>
            {renderContent()}
        </Card>
    );
};
