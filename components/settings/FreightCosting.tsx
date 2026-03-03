
import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MOCK_FREIGHT_AGENTS, MOCK_FREIGHT_RATES, MOCK_ADDITIONAL_CHARGES } from '../../constants';
import { FreightAgent, FreightRate } from '../../types';
import { StarIcon } from '../icons/Icons';

type FreightTab = 'Agents' | 'Rate Cards' | 'Additional Charges' | 'Calculator';

export const FreightCosting: React.FC = () => {
    const [activeTab, setActiveTab] = useState<FreightTab>('Agents');

    const renderContent = () => {
        switch(activeTab) {
            case 'Agents': return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {MOCK_FREIGHT_AGENTS.map(agent => (
                        <Card key={agent.id} className={agent.status === 'Inactive' ? 'opacity-60' : ''}>
                            <div className="flex justify-between items-center">
                                <h4 className="font-bold text-lg">{agent.name}</h4>
                                <span className={`px-2 py-0.5 text-xs rounded-full ${agent.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{agent.status}</span>
                            </div>
                            <p className="text-sm text-gray-500">{agent.email}</p>
                            <div className="flex items-center gap-1 mt-2">
                                {Array.from({length: 5}).map((_, i) => <StarIcon key={i} className={`w-4 h-4 ${i < agent.rating ? 'text-yellow-400' : 'text-gray-300'}`} />)}
                                <span className="text-xs ml-1">{agent.rating}/5</span>
                            </div>
                             <div className="mt-4 flex justify-end gap-2">
                                <Button variant="secondary" className="text-xs py-1 px-2">View Rates</Button>
                            </div>
                        </Card>
                    ))}
                </div>
            );
            case 'Rate Cards': return (
                <div>
                    <h4 className="font-semibold mb-4">Rate Cards</h4>
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>{['Mode', 'Route', 'Rate', 'Lead Time', 'Effective Date'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium uppercase">{h}</th>)}</tr>
                            </thead>
                            <tbody className="divide-y dark:divide-gray-700">
                                {MOCK_FREIGHT_RATES.map(rate => (
                                    <tr key={rate.id} className={rate.isExpired ? 'text-gray-400 line-through' : ''}>
                                        <td className="px-4 py-3">{rate.mode}</td>
                                        <td className="px-4 py-3">{rate.origin} → {rate.destination}</td>
                                        <td className="px-4 py-3 font-semibold">${rate.rate.toFixed(2)} / {rate.unit.replace('per ','')}</td>
                                        <td className="px-4 py-3">{rate.leadTime}</td>
                                        <td className="px-4 py-3">{rate.effectiveDate}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
            // Other tabs are placeholders for brevity
            default: return <p>This section is under construction.</p>
        }
    }
    
    return (
        <Card>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold">Freight Costing Management</h3>
                    <p className="text-sm text-gray-500">Manage agent rates, routes, and shipping costs.</p>
                </div>
                <Button>Add New Agent</Button>
            </div>
            <div className="flex border-b dark:border-gray-700 mb-6">
                 {(['Agents', 'Rate Cards', 'Additional Charges', 'Calculator'] as FreightTab[]).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium ${activeTab === tab ? 'border-b-2 border-primary-500 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>{tab}</button>
                ))}
            </div>
            {renderContent()}
        </Card>
    );
};
