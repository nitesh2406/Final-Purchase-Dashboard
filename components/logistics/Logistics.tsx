import React, { useState, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
    MagnifyingGlassIcon, FunnelIcon, EyeIcon, ArrowLeftIcon, 
    XMarkIcon, CheckBadgeIcon, ExclamationTriangleIcon, 
    DocumentArrowDownIcon, CalendarDaysIcon, ListBulletIcon,
    ChevronLeftIcon, ChevronRightIcon, ArrowsUpDownIcon, 
    ClipboardDocumentIcon, BoxIcon, PaperClipIcon
} from '../icons/Icons';
import { PurchaseOrder } from '../../types';
import { CustomizationModal } from './CustomizationModal';

const statusColors: Record<string, string> = {
    'Placed': 'bg-blue-600 text-white',
    'Partially Dispatched': 'bg-yellow-600 text-white',
    'Fully Dispatched': 'bg-green-600 text-white',
    'Completed': 'bg-emerald-600 text-white',
    'Cancelled': 'bg-red-600/20 text-red-400 border border-red-600/30',
};

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// --- Update Status Modal ---
const StatusUpdateModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    po: PurchaseOrder | null;
    onUpdate: (status: string, date: string, notes: string) => void;
}> = ({ isOpen, onClose, po, onUpdate }) => {
    const [status, setStatus] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    if (!isOpen || !po) return null;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-in fade-in duration-200">
            <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-150">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-semibold text-white">Update Status: {po.id}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><XMarkIcon className="w-5 h-5" /></button>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">New Status</label>
                        <div className="space-y-2">
                            {['Partially Dispatched', 'Fully Dispatched'].map(s => (
                                <label key={s} className="flex items-center gap-3 p-3 rounded-lg border border-slate-700 bg-slate-800/50 cursor-pointer hover:border-blue-500 transition-all">
                                    <input type="radio" name="status" value={s} checked={status === s} onChange={e => setStatus(e.target.value)} className="w-4 h-4 accent-blue-500" />
                                    <span className="text-sm text-white">{s}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Dispatch Date</label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Internal Notes</label>
                        <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any dispatch details..." className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                    </div>
                </div>

                <div className="flex gap-3 mt-8">
                    <Button variant="secondary" onClick={onClose} className="flex-1 h-11">Cancel</Button>
                    <Button onClick={() => onUpdate(status, date, notes)} disabled={!status} className="flex-1 bg-blue-600 hover:bg-blue-700 h-11">Update Status</Button>
                </div>
            </div>
        </div>
    );
};

// --- PO Detail View ---
const PurchaseOrderDetail: React.FC<{
    po: PurchaseOrder;
    onBack: () => void;
    onUpdateStatus: () => void;
}> = ({ po, onBack, onUpdateStatus }) => {
    return (
        <div className="flex flex-col space-y-6 animate-in fade-in duration-300 text-slate-800 dark:text-white">
            <div className="flex justify-between items-center px-1">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="p-2 -ml-2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-white transition-colors"><ArrowLeftIcon className="w-6 h-6" /></button>
                    <div>
                        <h2 className="text-xl font-semibold flex items-center gap-3">
                            Purchase Order: <span className="font-mono text-blue-500 dark:text-blue-400">{po.id}</span>
                            <span className={`px-2 py-0.5 text-[10px] rounded uppercase tracking-wider ${statusColors[po.status]}`}>{po.status}</span>
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Detailed breakdown of vendor items and customization</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={onBack} className="h-9 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300">Back to Orders</Button>
                    <Button onClick={onUpdateStatus} className="bg-green-600 hover:bg-green-700 h-9 font-semibold text-white">Mark as Dispatched</Button>
                </div>
            </div>

            <Card className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-450 dark:text-slate-500 uppercase">PO Number</p>
                    <p className="text-lg font-mono font-bold text-slate-800 dark:text-white">{po.id}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-450 dark:text-slate-500 uppercase">Vendor</p>
                    <p className="text-lg text-slate-800 dark:text-white font-medium">{po.vendor}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-450 dark:text-slate-500 uppercase">PO Date</p>
                    <p className="text-lg text-slate-800 dark:text-white">{formatDate(po.createdDate)}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-450 dark:text-slate-500 uppercase">Expected Delivery</p>
                    <p className="text-lg text-slate-800 dark:text-white">{formatDate(po.expectedDeliveryDate || '')}</p>
                </div>
            </Card>

            <Card className="bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 p-0 overflow-hidden shadow-xl">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
                    <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Ordered Items</h3>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{po.items.length} SKUs included</span>
                </div>
                <div className="overflow-x-auto min-w-[1000px]">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-900/20 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50 block-row">
                                <th className="px-6 py-3 font-medium">SKU</th>
                                <th className="px-6 py-3 font-medium">Item Name</th>
                                <th className="px-6 py-3 font-medium text-center">Qty</th>
                                <th className="px-6 py-3 font-medium text-right">Price</th>
                                <th className="px-6 py-3 font-medium text-right">Total</th>
                                <th className="px-6 py-3 font-medium text-center">Customization</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                            {po.items.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-100 dark:hover:bg-slate-700/20 transition-colors duration-150">
                                    <td className="px-6 py-4 font-mono text-blue-500 dark:text-blue-300">{item.skuId}</td>
                                    <td className="px-6 py-4 text-slate-800 dark:text-white">Item Placeholder {idx + 1}</td>
                                    <td className="px-6 py-4 text-center font-bold text-slate-800 dark:text-white">{item.quantity}</td>
                                    <td className="px-6 py-4 text-right text-slate-500 dark:text-slate-400 font-medium">₹{item.unitCost.toLocaleString()}</td>
                                    <td className="px-6 py-4 text-right font-bold text-slate-800 dark:text-white">₹{(item.quantity * item.unitCost).toLocaleString()}</td>
                                    <td className="px-6 py-4 text-center">
                                        {(po.customLogo || po.customPackaging) ? (
                                            <button className="p-1.5 hover:bg-blue-600/20 rounded text-blue-500 dark:text-blue-400 transition-all"><PaperClipIcon className="w-4 h-4" /></button>
                                        ) : <span className="text-slate-400">-</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-6 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-12">
                    <div className="text-right">
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">Total Quantity</p>
                        <p className="text-2xl font-bold text-slate-800 dark:text-white">{po.totalQty}</p>
                    </div>
                    <div className="text-right pr-4">
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">Grand Total</p>
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(po.amount || 0)}</p>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export const Logistics: React.FC = () => {
    const [activeTab, setActiveTab] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
    const [isStatusModalOpen, setStatusModalOpen] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    // Mock data expansion for visibility
    const [orders, setOrders] = useState<PurchaseOrder[]>([
        { id: 'PO-2024-001', vendor: 'GAN Cubes', createdDate: '2024-05-01', expectedDeliveryDate: '2024-05-15', status: 'Completed', pipelineStatus: 'Out for Delivery', items: [{ skuId: 'SKU-001', quantity: 100, unitCost: 25.50 }], totalQty: 100, amount: 212000, lastUpdated: '2024-05-28' },
        { id: 'PO-2024-002', vendor: 'MoYu', createdDate: '2024-05-15', expectedDeliveryDate: '2024-05-30', status: 'Placed', pipelineStatus: 'In Transit to India', items: [{ skuId: 'SKU-002', quantity: 200, unitCost: 8.00 }], totalQty: 200, amount: 133000, lastUpdated: '2024-05-25' },
        { id: 'PO-2024-003', vendor: 'QiYi', createdDate: '2024-05-20', expectedDeliveryDate: '2024-06-05', status: 'Partially Dispatched', pipelineStatus: 'PO Placed', items: [{ skuId: 'SKU-003', quantity: 50, unitCost: 9.50 }], totalQty: 50, amount: 45000, lastUpdated: '2024-05-22' },
    ]);

    const filteredOrders = useMemo(() => {
        return orders.filter(o => {
            const matchesTab = activeTab === 'All' || o.status === activeTab;
            const term = searchTerm.toLowerCase();
            const matchesSearch = o.id.toLowerCase().includes(term) || o.vendor.toLowerCase().includes(term);
            return matchesTab && matchesSearch;
        });
    }, [orders, activeTab, searchTerm]);

    const handleUpdateStatus = (status: string, date: string, notes: string) => {
        if (!selectedPO) return;
        setOrders(prev => prev.map(o => o.id === selectedPO.id ? { ...o, status: status as any, lastUpdated: date } : o));
        setToast(`Order ${selectedPO.id} status updated to ${status}`);
        setStatusModalOpen(false);
        setTimeout(() => setToast(null), 3000);
    };

    if (selectedPO) {
        return (
            <div className="p-6 bg-slate-50 dark:bg-slate-900 min-h-screen text-slate-800 dark:text-white">
                <PurchaseOrderDetail po={selectedPO} onBack={() => setSelectedPO(null)} onUpdateStatus={() => setStatusModalOpen(true)} />
                <StatusUpdateModal isOpen={isStatusModalOpen} onClose={() => setStatusModalOpen(false)} po={selectedPO} onUpdate={handleUpdateStatus} />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full space-y-4 text-slate-800 dark:text-white p-6 bg-slate-50 dark:bg-slate-900 min-h-screen relative">
            {toast && (
                <div className="fixed top-24 right-8 z-[150] animate-in slide-in-from-right-8 duration-300">
                    <div className="bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 border border-emerald-500/50">
                        <CheckBadgeIcon className="w-5 h-5" />
                        <span className="text-sm font-medium">{toast}</span>
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center px-1">
                <div>
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-white">Purchase Orders</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Track and manage your submitted vendor orders</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" className="border-slate-205 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300" icon={<FunnelIcon className="w-4 h-4"/>}>Filters</Button>
                </div>
            </div>

            <div className="space-y-4">
                <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                    <input 
                        type="text"
                        placeholder="Search by PO number, vendor, or item..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-505 text-sm shadow-sm text-slate-850 dark:text-white"
                    />
                </div>

                <div className="flex gap-8 border-b border-slate-200 dark:border-slate-800 px-1">
                    {['All', 'Placed', 'Partially Dispatched', 'Fully Dispatched', 'Completed'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`pb-3 text-sm font-medium transition-all relative ${
                                activeTab === tab ? 'text-blue-500 font-semibold' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                            }`}
                        >
                            {tab}
                            {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                        </button>
                    ))}
                </div>
            </div>

            <Card className="flex-grow overflow-hidden p-0 flex flex-col bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 shadow-xl">
                <div className="overflow-x-auto min-w-[1100px]">
                    {filteredOrders.length > 0 ? (
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-550 dark:text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                                    <th className="px-6 py-3 font-medium">PO Number</th>
                                    <th className="px-6 py-3 font-medium">Vendor</th>
                                    <th className="px-6 py-3 font-medium">PO Date</th>
                                    <th className="px-6 py-3 font-medium">Expected Delivery</th>
                                    <th className="px-6 py-3 font-medium text-center">Status</th>
                                    <th className="px-6 py-3 font-medium text-center">Items</th>
                                    <th className="px-6 py-3 font-medium text-right">Total Amount</th>
                                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                                {filteredOrders.map((o) => (
                                    <tr key={o.id} onClick={() => setSelectedPO(o)} className="group hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-colors duration-150 cursor-pointer">
                                        <td className="px-6 py-4 font-mono font-bold text-blue-500 dark:text-blue-400">{o.id}</td>
                                        <td className="px-6 py-4 text-slate-700 dark:text-slate-200">{o.vendor}</td>
                                        <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-xs">{formatDate(o.createdDate)}</td>
                                        <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-xs">{formatDate(o.expectedDeliveryDate || '')}</td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wider ${statusColors[o.status] || 'bg-slate-600'}`}>{o.status}</span>
                                        </td>
                                        <td className="px-6 py-4 text-center text-slate-500 dark:text-slate-300">{o.totalQty}</td>
                                        <td className="px-6 py-4 text-right font-medium text-slate-800 dark:text-white">{formatCurrency(o.amount || 0)}</td>
                                        <td className="px-6 py-4 text-right">
                                            <button className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded text-slate-450 hover:text-blue-500 dark:hover:text-blue-400 transition-all"><EyeIcon className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="py-24 flex flex-col items-center justify-center text-slate-500">
                            {searchTerm ? (
                                <>
                                    <MagnifyingGlassIcon className="w-12 h-12 mb-4 opacity-20" />
                                    <h3 className="text-lg font-medium">No orders found for "{searchTerm}"</h3>
                                    <p className="text-sm">Try different keywords or check your filters.</p>
                                </>
                            ) : (
                                <>
                                    <ListBulletIcon className="w-12 h-12 mb-4 opacity-20" />
                                    <h3 className="text-lg font-medium">No purchase orders yet</h3>
                                    <p className="text-sm">Submit draft orders to see them here tracking in real-time.</p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
};