
import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MOCK_APPROVAL_RULES } from '../../constants';

type ApprovalTab = 'Invoice' | 'Payment' | 'PO' | 'Dashboard';

export const ApprovalWorkflows: React.FC = () => {
    const [activeTab, setActiveTab] = useState<ApprovalTab>('Invoice');
    
    return (
         <Card>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold">Approval Workflows</h3>
                    <p className="text-sm text-gray-500">Configure approval rules for invoices, payments, and POs.</p>
                </div>
                <Button>Add New Rule</Button>
            </div>
            <div className="flex border-b dark:border-gray-700 mb-6">
                 {(['Invoice', 'Payment', 'PO', 'Dashboard'] as ApprovalTab[]).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium ${activeTab === tab ? 'border-b-2 border-primary-500 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>{tab}</button>
                ))}
            </div>
             <div className="overflow-x-auto">
                <table className="min-w-full">
                    <thead className="bg-gray-50 dark:bg-gray-800"><tr>{['Rule Name', 'Condition', 'Approvers', 'Status', 'Actions'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium uppercase">{h}</th>)}</tr></thead>
                    <tbody className="divide-y dark:divide-gray-700">
                        {MOCK_APPROVAL_RULES.filter(rule => rule.type === activeTab).map(rule => <tr key={rule.id}>
                            <td className="px-4 py-3 font-medium">{rule.name}</td>
                            <td className="px-4 py-3 font-mono text-xs">{rule.condition}</td>
                            <td className="px-4 py-3">{rule.approvers.join(', ')}</td>
                            <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 text-xs rounded-full ${rule.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{rule.status}</span>
                            </td>
                            <td className="px-4 py-3"><Button variant="secondary" className="text-xs py-1 px-2">Edit</Button></td>
                        </tr>)}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};
