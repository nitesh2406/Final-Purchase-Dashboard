
import React from 'react';
// FIX: Corrected import path for ViewType.
import { ViewType } from '../../App';
import {
  ChartPieIcon, CubeIcon, ShoppingCartIcon, GlobeAltIcon, TruckIcon,
  CurrencyDollarIcon, ChartBarIcon, Cog6ToothIcon, ChevronDoubleLeftIcon, BeakerIcon,
  PresentationChartLineIcon, DocumentTextIcon, ClipboardDocumentIcon, ListBulletIcon, CloudArrowUpIcon,
  BriefcaseIcon, CreditCardIcon,
  GlobeAltIcon as MapIcon, BoxIcon as PackageIcon
} from '../icons/Icons';

interface SidebarProps {
  currentView: ViewType;
  setView: (view: ViewType) => void;
  isCollapsed: boolean;
  setIsCollapsed: (isCollapsed: boolean) => void;
}

const navItems: { name: ViewType; icon: React.ReactNode; wip?: boolean; group?: string }[] = [
  { name: 'Dashboard', icon: <ChartPieIcon className="w-6 h-6" />, group: 'Main', wip: true },
  { name: 'Inventory Forecasting', icon: <PresentationChartLineIcon className="w-6 h-6" />, group: 'Main' },
  { name: 'Inventory Analytics', icon: <ChartBarIcon className="w-6 h-6" />, group: 'Main', wip: true },
  { name: 'Draft Orders', icon: <ListBulletIcon className="w-6 h-6" />, group: 'Procurement' },
  { name: 'Purchase Orders', icon: <ClipboardDocumentIcon className="w-6 h-6" />, group: 'Procurement' },
  { name: 'Vendor Shipments', icon: <CloudArrowUpIcon className="w-6 h-6" />, group: 'Logistics' },
  { name: 'Shipment Tracker', icon: <TruckIcon className="w-6 h-6" />, group: 'Logistics' },
  { name: 'Shipment Finance', icon: <BriefcaseIcon className="w-6 h-6" />, group: 'Finance' },
  { name: 'Payment Ledger', icon: <CreditCardIcon className="w-6 h-6" />, group: 'Finance', wip: true },
  { name: 'Accounts View', icon: <DocumentTextIcon className="w-6 h-6" />, group: 'Finance', wip: true },
  { name: 'Settings', icon: <Cog6ToothIcon className="w-6 h-6" />, group: 'Other' },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, setView, isCollapsed, setIsCollapsed }) => {
  const groups = ['Main', 'Procurement', 'Logistics', 'Finance', 'Other'];

  return (
    <aside className={`fixed top-0 left-0 h-full bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col transition-all duration-300 z-50 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      <div className={`h-20 flex items-center border-b dark:border-gray-700 ${isCollapsed ? 'justify-center' : 'justify-center'}`}>
        <span className={`text-xl font-bold text-primary-600 dark:text-primary-400 ${isCollapsed ? 'text-2xl' : ''}`}>
          {isCollapsed ? 'P' : 'Purchasing ERP'}
        </span>
      </div>
      <nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden">
        {groups.map(group => {
          const items = navItems.filter(item => item.group === group);
          return (
            <div key={group} className="mb-3">
              {!isCollapsed && (
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
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
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                  >
                    {item.icon}
                    {!isCollapsed && (
                      <span className="ml-3 flex-1 whitespace-nowrap text-left">{item.name}</span>
                    )}
                    {!isCollapsed && item.wip && (
                      <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400 flex-shrink-0">
                        Test
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="p-2 border-t dark:border-gray-700">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center p-2.5 text-sm font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <ChevronDoubleLeftIcon className={`w-6 h-6 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
          <span className={`ml-3 whitespace-nowrap transition-opacity duration-200 ${isCollapsed ? 'opacity-0 hidden' : 'opacity-100'}`}>{isCollapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </div>
    </aside>
  );
};
