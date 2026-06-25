
import React from 'react';
import { ViewType } from '../../types';
import {
  ChartPieIcon, CubeIcon, ShoppingCartIcon, GlobeAltIcon, TruckIcon,
  CurrencyDollarIcon, ChartBarIcon, Cog6ToothIcon, ChevronDoubleLeftIcon, BeakerIcon,
  PresentationChartLineIcon, DocumentTextIcon, ClipboardDocumentIcon, ListBulletIcon, CloudArrowUpIcon,
  BriefcaseIcon, CreditCardIcon, BuildingLibraryIcon,
  GlobeAltIcon as MapIcon, BoxIcon as PackageIcon
} from '../icons/Icons';

interface SidebarProps {
  currentView: ViewType;
  setView: (view: ViewType) => void;
  isCollapsed: boolean;
  setIsCollapsed: (isCollapsed: boolean) => void;
  user?: any;
}

const navItems: { name: ViewType; icon: React.ReactNode; wip?: boolean; group?: string }[] = [
  { name: 'Dashboard', icon: <ChartPieIcon className="w-6 h-6" />, group: 'Main', wip: true },
  { name: 'Inventory Forecasting', icon: <PresentationChartLineIcon className="w-6 h-6" />, group: 'Main' },
  { name: 'Inventory Analytics', icon: <ChartBarIcon className="w-6 h-6" />, group: 'Main', wip: true },
  { name: 'Draft Orders', icon: <ListBulletIcon className="w-6 h-6" />, group: 'Procurement' },
  { name: 'Purchase Orders', icon: <ClipboardDocumentIcon className="w-6 h-6" />, group: 'Procurement' },
  { name: 'Create SKU', icon: <CubeIcon className="w-6 h-6" />, group: 'Procurement' },
  { name: 'Vendor Shipments', icon: <CloudArrowUpIcon className="w-6 h-6" />, group: 'Logistics' },
  { name: 'Shipment Tracker', icon: <TruckIcon className="w-6 h-6" />, group: 'Logistics' },
  { name: 'Shipment Finance', icon: <BriefcaseIcon className="w-6 h-6" />, group: 'Finance' },
  { name: 'Payment Ledger', icon: <CreditCardIcon className="w-6 h-6" />, group: 'Finance', wip: true },
  { name: 'Settlement Ledger', icon: <BuildingLibraryIcon className="w-6 h-6" />, group: 'Finance', wip: true },
  { name: 'Accounts View', icon: <DocumentTextIcon className="w-6 h-6" />, group: 'Finance', wip: true },
  { name: 'Amazon Forecasting', icon: <ShoppingCartIcon className="w-6 h-6" />, group: 'Amazon' },
  { name: 'Settings', icon: <Cog6ToothIcon className="w-6 h-6" />, group: 'Other' },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, setView, isCollapsed, setIsCollapsed, user }) => {
  const groups = ['Main', 'Procurement', 'Logistics', 'Finance', 'Amazon', 'Other'];

  const checkAllowed = (name: string, group: string) => {
    if (!user) return false;
    if (user.role === 'ADMIN' || (user.allowedTabs && user.allowedTabs.includes('all'))) {
      return true;
    }
    const tabs = user.allowedTabs || [];
    if (name === 'Dashboard') return true;
    if (name === 'Inventory Forecasting') return tabs.includes('forecasting');
    if (name === 'Draft Orders') return tabs.includes('drafts');
    if (name === 'Purchase Orders') return tabs.includes('purchase_orders');
    if (name === 'Vendor Shipments') return tabs.includes('shipments');
    if (name === 'Settings') return tabs.includes('settings');
    if (group === 'Finance') return tabs.includes('finance');
    if (group === 'Amazon') return tabs.includes('forecasting') || tabs.includes('amazon');
    if (name === 'Shipment Tracker') return tabs.includes('shipments');
    if (name === 'Inventory Analytics') return tabs.includes('forecasting');
    if (name === 'Create SKU') return tabs.includes('create_sku') || tabs.includes('drafts');
    return false;
  };

  return (
    <aside className={`fixed top-0 left-0 h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-all duration-300 z-50 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      <div className={`h-20 flex items-center border-b border-slate-200 dark:border-slate-800 ${isCollapsed ? 'justify-center' : 'justify-center'}`}>
        <span className={`text-xl font-bold text-blue-600 dark:text-blue-400 ${isCollapsed ? 'text-2xl' : ''}`}>
          {isCollapsed ? 'P' : 'Purchasing ERP'}
        </span>
      </div>
      <nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden">
        {groups.map(group => {
          const items = navItems.filter(item => item.group === group && checkAllowed(item.name, group));
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-3">
              {!isCollapsed && (
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  {group}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map(item => (
                  <button
                    key={item.name}
                    title={item.name}
                    onClick={() => setView(item.name)}
                    className={`w-full flex items-center p-2.5 text-sm font-medium rounded-lg transition-colors ${isCollapsed ? 'justify-center' : ''}
                      ${currentView === item.name
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                  >
                    {item.icon}
                    {!isCollapsed && (
                      <span className="ml-3 flex-1 whitespace-nowrap text-left">{item.name}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="p-2 border-t border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center p-2.5 text-sm font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ChevronDoubleLeftIcon className={`w-6 h-6 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
          <span className={`ml-3 whitespace-nowrap transition-opacity duration-200 ${isCollapsed ? 'opacity-0 hidden' : 'opacity-100'}`}>{isCollapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </div>
    </aside>
  );
};
