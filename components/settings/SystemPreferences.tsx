
import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MOCK_USERS, MOCK_ROLES_PERMISSIONS, MOCK_NOTIFICATION_RULES } from '../../constants';

type PrefTab = 'General' | 'Notifications' | 'Data & Security' | 'Integrations' | 'User Management' | 'Import/Export';

export const SystemPreferences: React.FC = () => {
    const [activeTab, setActiveTab] = useState<PrefTab>('General');

    const renderContent = () => {
        switch(activeTab) {
            case 'General': return (
                <div>
                    <h4 className="font-semibold mb-2">Organization Info</h4>
                    <div className="grid grid-cols-2 gap-4">
                        {/* Form fields for org info */}
                    </div>
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
