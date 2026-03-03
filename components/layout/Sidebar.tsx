
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

const navItems: { name: ViewType; icon: React.ReactNode }[] = [
  { name: 'Dashboard', icon: <ChartPieIcon className="w-6 h-6" /> },
  { name: 'Inventory Forecasting', icon: <PresentationChartLineIcon className="w-6 h-6" /> },
  { name: 'Draft Orders', icon: <ListBulletIcon className="w-6 h-6" /> },
  { name: 'Purchase Orders', icon: <ClipboardDocumentIcon className="w-6 h-6" /> },
  { name: 'Vendor Shipments', icon: <CloudArrowUpIcon className="w-6 h-6" /> },
  { name: 'Shipment Tracker', icon: <TruckIcon className="w-6 h-6" /> },
  { name: 'Shipment Finance', icon: <BriefcaseIcon className="w-6 h-6" /> },
  { name: 'Payment Ledger', icon: <CreditCardIcon className="w-6 h-6" /> },
  { name: 'Accounts View', icon: <DocumentTextIcon className="w-6 h-6" /> },
  { name: 'Inventory Analytics', icon: <ChartBarIcon className="w-6 h-6" /> },
  { name: 'Settings', icon: <Cog6ToothIcon className="w-6 h-6" /> },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, setView, isCollapsed, setIsCollapsed }) => {
  return (
    <aside className={`fixed top-0 left-0 h-full bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col transition-all duration-300 z-50 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      <div className={`h-20 flex items-center border-b dark:border-gray-700 ${isCollapsed ? 'justify-center' : 'justify-center'}`}>
         <span className={`text-xl font-bold text-primary-600 dark:text-primary-400 ${isCollapsed ? 'text-2xl' : ''}`}>
          {isCollapsed ? 'P' : 'Purchasing ERP'}
         </span>
      </div>
      <nav className="flex-1 p-2 space-y-2 overflow-y-auto overflow-x-hidden">
        {navItems.map(item => (
          <button
            key={item.name}
            title={item.name}
            onClick={() => setView(item.name)}
            className={`w-full flex items-center p-2.5 text-sm font-medium rounded-lg transition-colors ${isCollapsed ? 'justify-center' : ''}
              ${currentView === item.name
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`
            }
          >
            {item.icon}
            <span className={`ml-3 whitespace-nowrap transition-opacity duration-200 ${isCollapsed ? 'opacity-0 hidden' : 'opacity-100'}`}>{item.name}</span>
          </button>
        ))}
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
