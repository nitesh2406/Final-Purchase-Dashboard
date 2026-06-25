import React from 'react';
import { Card } from '../ui/Card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, AreaChart, Area } from 'recharts';
import { MOCK_SKUS, MOCK_SHIPMENTS, MOCK_PURCHASE_ORDERS } from '../../constants';
import { SmartAssistant } from './SmartAssistant';
import { 
    PlusIcon, 
    // FIX: Removed invalid ArrowUpTrayIcon import and added missing icons AirplaneIcon, ShipIcon, and InformationCircleIcon.
    BanknotesIcon, 
    ShoppingCartIcon, 
    TruckIcon, 
    ClockIcon,
    ChevronRightIcon,
    ExclamationTriangleIcon,
    AirplaneIcon,
    ShipIcon,
    InformationCircleIcon
} from '../icons/Icons';
import { Button } from '../ui/Button';

// Additional icons for Quick Actions
const ArrowUpTrayIcon_Local = (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
);

const salesData = [
  { name: 'Jan', sales: 4200, purchase: 2400 },
  { name: 'Feb', sales: 3800, purchase: 1398 },
  { name: 'Mar', sales: 5200, purchase: 9800 },
  { name: 'Apr', sales: 4800, purchase: 3908 },
  { name: 'May', sales: 6100, purchase: 4800 },
  { name: 'Jun', sales: 5800, purchase: 3800 },
];

const MetricCard: React.FC<{ title: string; value: string; change?: string; changeType?: 'increase' | 'decrease'; icon?: React.ReactNode }> = ({ title, value, change, changeType, icon }) => (
    <Card className="relative overflow-hidden group">
        <div className="flex justify-between items-start">
            <div>
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate uppercase tracking-wider">{title}</h3>
                <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">{value}</p>
                {change && (
                    <p className={`mt-2 text-xs font-semibold flex items-center ${changeType === 'increase' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {changeType === 'increase' ? '▲' : '▼'} {change}
                        <span className="text-slate-400 font-normal ml-1">vs last month</span>
                    </p>
                )}
            </div>
            {icon && <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl group-hover:scale-110 transition-transform">{icon}</div>}
        </div>
    </Card>
);

const QuickAction: React.FC<{ label: string; icon: React.ReactNode; color: string }> = ({ label, icon, color }) => (
    <button className="flex flex-col items-center gap-2 group">
        <div className={`w-14 h-14 rounded-2xl ${color} flex items-center justify-center text-white shadow-lg group-hover:-translate-y-1 transition-all group-active:scale-95`}>
            {icon}
        </div>
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 group-hover:text-blue-500">{label}</span>
    </button>
);

export const Dashboard: React.FC = () => {
  const topSellingItems = [...MOCK_SKUS].sort((a, b) => (b.salesVelocity || 0) - (a.salesVelocity || 0)).slice(0, 5);
  const ongoingShipments = MOCK_SHIPMENTS.filter(s => s.status !== 'Delivered' && s.status !== 'Shipment Lost').slice(0, 3);
  const activeShipmentsCount = MOCK_SHIPMENTS.filter(s => s.status !== 'Delivered').length;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto p-6 animate-in fade-in duration-500">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard 
            title="Total Revenue" 
            value="₹48,95,000" 
            change="12.5%" 
            changeType="increase" 
            icon={<BanknotesIcon className="w-6 h-6"/>}
        />
        <MetricCard 
            title="Active POs" 
            value={MOCK_PURCHASE_ORDERS.filter(p => p.status !== 'Completed').length.toString()} 
            change="2.1%" 
            changeType="decrease" 
            icon={<ShoppingCartIcon className="w-6 h-6"/>}
        />
        <MetricCard 
            title="Ongoing Imports" 
            value={activeShipmentsCount.toString()} 
            icon={<TruckIcon className="w-6 h-6"/>}
        />
        <MetricCard 
            title="Inventory Value" 
            value="₹1.2 Cr" 
            icon={<BarChart className="w-6 h-6"/>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Chart Column */}
        <div className="lg:col-span-8 space-y-6">
            <Card>
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="font-bold text-lg text-slate-800 dark:text-white">Revenue & Procurement Trends</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Monthly overview of sales vs supply spend</p>
                    </div>
                    <div className="flex gap-2">
                        <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                            <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300">SALES</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
                            <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                            <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300">PURCHASES</span>
                        </div>
                    </div>
                </div>
                <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={salesData}>
                            <defs>
                                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-gray-200 dark:stroke-gray-700" />
                            <XAxis dataKey="name" className="text-[10px] font-medium" axisLine={false} tickLine={false} />
                            <YAxis className="text-[10px] font-medium" axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v/1000}k`} />
                            <Tooltip 
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            />
                            <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" name="Sales Revenue" />
                            <Line type="monotone" dataKey="purchase" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4 }} name="Purchase Value" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {/* Ongoing Imports Card */}
                <Card>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-base text-slate-800 dark:text-white flex items-center gap-2">
                            <TruckIcon className="w-5 h-5 text-blue-500" /> Ongoing Imports
                        </h3>
                        <Button variant="secondary" className="text-[10px] py-1 h-auto">View All</Button>
                    </div>
                    <div className="space-y-3">
                        {ongoingShipments.length > 0 ? ongoingShipments.map(s => (
                            <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-transparent hover:border-blue-500/30 transition-all cursor-pointer">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${s.mode === 'Air' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
                                        {s.mode === 'Air' ? <AirplaneIcon className="w-4 h-4"/> : <ShipIcon className="w-4 h-4"/>}
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-white">{s.id}</p>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{s.carrier} • {s.origin}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400">{s.status}</p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">ETA: {s.edd}</p>
                                </div>
                            </div>
                        )) : (
                            <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-xs italic">No active shipments in transit</div>
                        )}
                    </div>
                </Card>

                {/* Top SKUs */}
                <Card>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-base text-slate-800 dark:text-white flex items-center gap-2">
                            <ShoppingCartIcon className="w-5 h-5 text-emerald-500" /> Hot Selling Items
                        </h3>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">Last 30 Days</span>
                    </div>
                    <div className="space-y-4">
                        {topSellingItems.map(item => (
                            <div key={item.id} className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-400 text-xs">
                                    {item.name.charAt(0)}
                                </div>
                                <div className="flex-grow">
                                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[150px]">{item.name}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <div className="flex-grow bg-slate-200 dark:bg-slate-700 h-1 rounded-full overflow-hidden">
                                            <div
                                                className="bg-blue-500 h-full rounded-full"
                                                style={{ width: `${(item.salesVelocity / 30) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">{item.salesVelocity.toFixed(1)}/d</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>

        {/* Sidebar Column */}
        <div className="lg:col-span-4 space-y-6">
            {/* Quick Actions Panel */}
            <Card className="bg-white dark:bg-gradient-to-br dark:from-blue-700 dark:to-blue-900 border border-slate-200 dark:border-none shadow-xl">
                <h3 className="font-bold text-slate-800 dark:text-white mb-6 text-sm flex items-center gap-2">
                    <ClockIcon className="w-4 h-4 text-blue-500 dark:text-white/70" /> Quick Command Hub
                </h3>
                <div className="grid grid-cols-3 gap-4 font-bold">
                    <QuickAction label="New PO" icon={<PlusIcon className="w-6 h-6"/>} color="bg-blue-600 dark:bg-white/20 hover:bg-blue-700 dark:hover:bg-white/30 text-white" />
                    <QuickAction label="Import Doc" icon={<ArrowUpTrayIcon_Local className="w-6 h-6"/>} color="bg-indigo-600 dark:bg-white/20 hover:bg-indigo-700 dark:hover:bg-white/30 text-white" />
                    <QuickAction label="Forecasting" icon={<BarChart className="w-6 h-6"/>} color="bg-purple-600 dark:bg-white/20 hover:bg-purple-700 dark:hover:bg-white/30 text-white" />
                </div>
            </Card>

            <SmartAssistant />

            {/* Notifications & Action Items */}
            <Card>
                <h3 className="font-bold text-base text-slate-800 dark:text-white mb-4">Pending Tasks</h3>
                <div className="space-y-3">
                    <div className="group flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-800/30 transition-all hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer">
                        <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 mt-0.5" />
                        <div className="flex-grow">
                            <p className="text-xs font-bold text-amber-900 dark:text-amber-200">PO-2024-002 Arrival</p>
                            <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">Estimated tomorrow. Review port documents.</p>
                        </div>
                        <ChevronRightIcon className="w-4 h-4 text-amber-400 group-hover:translate-x-1 transition-transform" />
                    </div>
                    
                    <div className="group flex items-start gap-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200/50 dark:border-rose-800/30 transition-all hover:bg-rose-100 dark:hover:bg-rose-900/40 cursor-pointer">
                        <ExclamationTriangleIcon className="w-5 h-5 text-rose-500 mt-0.5" />
                        <div className="flex-grow">
                            <p className="text-xs font-bold text-rose-900 dark:text-rose-200">Payment Overdue</p>
                            <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">INV-004 is 5 days past due. Action required.</p>
                        </div>
                        <ChevronRightIcon className="w-4 h-4 text-rose-400 group-hover:translate-x-1 transition-transform" />
                    </div>

                    <div className="group flex items-start gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-800/30 transition-all hover:bg-blue-100 dark:hover:bg-blue-900/40 cursor-pointer">
                        {/* FIX: Correctly used InformationCircleIcon now that it is imported. */}
                        <InformationCircleIcon className="w-5 h-5 text-blue-500 mt-0.5" />
                        <div className="flex-grow">
                            <p className="text-xs font-bold text-blue-900 dark:text-blue-200">New Vendor Approval</p>
                            <p className="text-[10px] text-blue-700 dark:text-blue-400 mt-0.5">'Super Cubes' requested master data setup.</p>
                        </div>
                        <ChevronRightIcon className="w-4 h-4 text-blue-400 group-hover:translate-x-1 transition-transform" />
                    </div>
                </div>
            </Card>
        </div>
      </div>
    </div>
  );
};