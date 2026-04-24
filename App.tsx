import React, { useState, useEffect, useCallback } from 'react';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { Header } from './components/layout/Header.tsx';
import { Dashboard } from './components/dashboard/Dashboard.tsx';
import { DraftOrdersTable } from './components/logistics/DraftOrdersTable.tsx';
import { PurchaseOrders } from './components/purchasing/PurchaseOrders.tsx';
import { VendorShipments } from './components/logistics/VendorShipments.tsx';
import { ShipmentTracker } from './components/logistics/ShipmentTracker.tsx';
import { BatchDetail } from './components/logistics/BatchDetail.tsx';
import { Logistics } from './components/logistics/Logistics.tsx';
import { Finance } from './components/finance/Finance.tsx';
import { InventoryAnalytics } from './components/inventory/InventoryAnalytics.tsx';
import { InventoryForecasting } from './components/inventory/InventoryForecasting.tsx';
import { Settings } from './components/settings/Settings.tsx';
import { AmazonForecasting } from './pages/AmazonForecasting.tsx';
import { NewSkuDashboard } from './components/dashboard/NewSkuDashboard.tsx';
import { NewSkuDetail } from './components/dashboard/NewSkuDetail.tsx';
import { ShipmentFinance } from './components/finance/ShipmentFinance.tsx';
import { ShipmentFinanceDetail } from './components/finance/ShipmentFinanceDetail.tsx';
import { PaymentLedger } from './components/finance/PaymentLedger.tsx';
import { AccountsView } from './components/finance/AccountsView.tsx';
import { Sku, PurchaseOrder, Shipment, Invoice, Vendor, Notification, DraftOrder, VendorMaster } from './types.ts';

export type ViewType = 'Dashboard' | 'Inventory Forecasting' | 'Draft Orders' | 'Purchase Orders' | 'Vendor Shipments' | 'Shipment Tracker' | 'Batch Detail' | 'Finance' | 'Inventory Analytics' | 'Settings' | 'Shipment Finance' | 'Shipment Finance Detail' | 'Payment Ledger' | 'Accounts View' | 'Amazon Forecasting' | 'Create SKU' | 'SKU Detail';

export const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycby2w_vPzSmxd1gFxlhbqdQevKuA-_bThNZG1s7AK-gIONmBCDmUg3-rBmC6S4HvZVDd/exec';

export const API_ACTIONS = {
    // Draft Operations
    GET_DRAFTS: 'get_drafts',
    GET_DRAFT_BY_ID: 'get_draft_by_id',
    CREATE_DRAFT_FROM_FORECAST: 'create_draft_from_forecast',
    SAVE_DRAFT: 'save_draft',
    CREATE_DRAFT: 'create_draft',
    SUBMIT_DRAFT: 'submit_draft',
    CANCEL_DRAFT: 'cancel_draft',
    DUPLICATE_DRAFT: 'duplicate_draft',
    SAVE_CUSTOMIZATION: 'save_customization',

    // Purchase Order Operations
    GET_PURCHASE_ORDERS: 'get_pos',
    GET_PURCHASE_ORDER_DETAILS: 'get_purchase_order_details',

    // Catalog Operations
    SEARCH_SKU_CATALOG: 'search_sku_catalog',
    ADD_SKU: 'add_sku',

    // Vendor Operations
    GET_VENDOR_MASTERS: 'get_vendor_masters',

    // Shipment Operations
    UPLOAD_SHIPMENT_DOCS: 'upload_shipment_docs',
    SHIPMENT_RERUN_MATCHING: 'shipment_rerun_matching',
    SHIPMENT_GET_ALLOCATION: 'shipment_get_allocation',
    SHIPMENT_CREATE: 'shipment_create',
    GET_OPEN_BATCHES: 'get_open_batches',

    // Finance Operations
    GET_BATCHES_FINANCE: 'get_batches_finance',
    GET_BATCH_FINANCE_DETAIL: 'get_batch_finance_detail',
    UPDATE_BATCH_TRACKING: 'update_batch_tracking',
    UPDATE_SHIPMENT_FINANCE: 'update_shipment_finance',
    UPDATE_BATCH_CURRENCY: 'update_batch_currency',
    GET_FX_RATES: 'get_fx_rates',
    GET_VENDOR_ACCOUNTS: 'get_vendor_accounts',
    LOG_PAYMENT: 'log_payment',
    GET_PAYMENTS: 'get_payments',
    GET_AGENT_INVOICES: 'get_agent_invoices',
    LOG_AGENT_INVOICE: 'log_agent_invoice',
    MAP_INVOICE_SHIPMENTS: 'map_invoice_shipments',
    // Amazon Operations
    GET_AMAZON_FORECAST:          'get_amazon_forecast',
    CONFIRM_AMAZON_SHIPMENT_PLAN: 'confirm_amazon_shipment_plan',
    GET_AMAZON_CONFIG:            'get_amazon_config',
    SAVE_AMAZON_CONFIG:           'save_amazon_config',

    // New SKU Operations
    GET_NEW_SKU_REQUESTS:    'getNewSkuRequests',
    GET_NEW_SKU_REQUEST_BY_ID: 'getNewSkuRequestById',
    SAVE_NEW_SKU_DRAFT:      'saveNewSkuDraft',
    GET_NEXT_AVAILABLE_SKU:  'getNextAvailableSku',
    GET_PRICING_CONFIG:      'getPricingConfig',
    GET_TAGS_BY_CATEGORY:    'getTagsByCategory',
    CREATE_SKU_ON_EE:        'createSkuOnEasyEcom',
    CREATE_SKU_ON_ZOHO:      'createSkuOnZoho',
    GET_PARENT_SKU_DETAILS:  'getParentSkuDetails',
    CREATE_SKU_ON_SHOPIFY:   'createSkuOnShopify',
    UPDATE_EE_PO:            'updateEePurchaseOrder',
    REJECT_SKU_REQUEST:      'rejectSkuRequest',
    CREATE_MANUAL_SKU:       'createManualSkuRequest',
    GET_BRANDS:   'getBrands',
    GET_VARIANTS: 'getVariants',
};

const App: React.FC = () => {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [currentView, setCurrentView] = useState<ViewType>('Dashboard');
    const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
    const [selectedFinanceBatchId, setSelectedFinanceBatchId] = useState<string | null>(null);
    const [selectedSkuRequestId, setSelectedSkuRequestId] = useState<string | null>(null);
    const [skuRequests, setSkuRequests] = useState<any[]>([]);
    const [skuRequestsLoaded, setSkuRequestsLoaded] = useState(false);
    const [highlightDraftId, setHighlightDraftId] = useState<string | null>(null);
    const [lastApiLog, setLastApiLog] = useState<{ action: string; status: number | string; timestamp: string } | null>(null);
    const [showGlobalDebug, setShowGlobalDebug] = useState(false);
    const [lastRefreshTime, setLastRefreshTime] = useState<string>(new Date().toLocaleTimeString());

    const [skus, setSkus] = useState<Sku[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [vendorMasters, setVendorMasters] = useState<VendorMaster[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [drafts, setDrafts] = useState<DraftOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [forecastingConfig, setForecastingConfig] = useState<any>(null);
    const [configLastLoaded, setConfigLastLoaded] = useState<Date | null>(null);
    const [amazonConfig, setAmazonConfig] = useState<any>(null);
    const [amazonConfigLastLoaded, setAmazonConfigLastLoaded] = useState<Date | null>(null);
    const [user, setUser] = useState<any>(() => {
        try {
            const stored = localStorage.getItem('auth_user');
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            const age = Date.now() - parsed.loggedInAt;
            if (age > 8 * 60 * 60 * 1000) {
                localStorage.removeItem('auth_user');
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    });

    useEffect(() => {
        const interval = setInterval(() => {
            const storedUser = localStorage.getItem('auth_user');
            if (storedUser) {
                try {
                    const parsed = JSON.parse(storedUser);
                    const age = Date.now() - parsed.loggedInAt;
                    if (age > 8 * 60 * 60 * 1000) {
                        localStorage.removeItem('auth_user');
                        setUser(null);
                        alert("Session expired. Please sign in again.");
                    }
                } catch (e) {
                    localStorage.removeItem('auth_user');
                    setUser(null);
                }
            }
        }, 60000); // Check every minute
        return () => clearInterval(interval);
    }, []);

    const handleLoginSuccess = (userData: any) => {
        localStorage.setItem('auth_user', JSON.stringify(userData));
        setUser(userData);
    };

    const handleLogout = () => {
        localStorage.removeItem('auth_user');
        setUser(null);
    };

    const fetchAllData = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const draftsPromise = fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: API_ACTIONS.GET_DRAFTS })
            }).then(res => res.json());

            const otherEndpoints = ['skus', 'pos', 'shipments', 'invoices', 'vendors', 'notifications', 'vendor_masters'];
            const otherPromises = otherEndpoints.map(e => fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'get_' + e })
            }).then(res => res.json()));

            const [draftsResponse, ...otherResponses] = await Promise.all([draftsPromise, ...otherPromises]);
            const [skusData, posData, shpData, invData, venData, notifData, venMastersData] = otherResponses;

            setLastApiLog({ action: 'GET_ALL_DATA', status: 200, timestamp: new Date().toLocaleTimeString() });
            setLastRefreshTime(new Date().toLocaleTimeString());

            if (draftsResponse && draftsResponse.drafts) {
                setDrafts(draftsResponse.drafts);
            }

            if (skusData.skus) setSkus(skusData.skus);
            if (posData.pos) setPurchaseOrders(posData.pos);
            if (shpData.shipments) setShipments(shpData.shipments);
            if (invData.invoices) setInvoices(invData.invoices);
            if (venData.vendors) setVendors(venData.vendors);
            if (notifData.notifications) setNotifications(notifData.notifications);
            if (venMastersData.vendors) setVendorMasters(venMastersData.vendors);

        } catch (err) {
            console.error("Critical error fetching dashboard data:", err);
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    const fetchConfig = useCallback(async () => {
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'get_forecasting_config' })
            });
            const data = await response.json();
            if (data && data.success && data.config) {
                setForecastingConfig(data.config);
                setConfigLastLoaded(new Date());
            }
        } catch (e) {
            console.error("Config fetch error:", e);
        }
    }, []);

    const fetchAmazonConfig = useCallback(async () => {
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'get_amazon_config' })
            });
            const data = await response.json();
            if (data && data.status === 'success' && data.config) {
                setAmazonConfig(data.config);
                setAmazonConfigLastLoaded(new Date());
            }
        } catch (e) {
            console.error('Amazon config fetch error:', e);
        }
    }, []);

    useEffect(() => {
        if (!user) return;
        fetchAllData();
        fetchConfig();
        fetchAmazonConfig();
    }, [user, fetchAllData, fetchConfig, fetchAmazonConfig]);

    const addSku = (newSkuData: Omit<Sku, 'id'>) => {
        const newSku: Sku = {
            id: `SKU-${(skus.length + 1).toString().padStart(3, '0')}`,
            ...newSkuData,
        };
        setSkus(prevSkus => [...prevSkus, newSku]);
        return newSku;
    };

    const updateSku = (updatedSku: Sku) => {
        setSkus(prevSkus => prevSkus.map(sku => sku.id === updatedSku.id ? updatedSku : sku));
    };

    const addInvoice = (invoiceData: Omit<Invoice, 'id'>) => {
        const newInvoice: Invoice = {
            id: `INV-2024-${(invoices.length + 1).toString().padStart(3, '0')}`,
            ...invoiceData
        };
        setInvoices(prev => [newInvoice, ...prev]);
    };

    const updateInvoice = (updatedInvoice: Invoice) => {
        setInvoices(prev => prev.map(inv => inv.id === updatedInvoice.id ? updatedInvoice : inv));
    };

    const updateMultipleInvoices = (updatedInvoices: Invoice[]) => {
        setInvoices(prev => prev.map(inv => {
            const updated = updatedInvoices.find(u => u.id === inv.id);
            return updated ? updated : inv;
        }));
    };

    const addVendor = (vendorData: Omit<Vendor, 'id'>) => {
        const newVendor: Vendor = {
            id: `V-${(vendors.length + 1).toString().padStart(3, '0')}`,
            ...vendorData
        };
        setVendors(prev => [newVendor, ...prev]);
    };

    const updateVendor = (updatedVendor: Vendor) => {
        setVendors(prev => prev.map(v => v.id === updatedVendor.id ? updatedVendor : v));
    };

    if (!user) {
        return <LoginPage onLoginSuccess={handleLoginSuccess} />;
    }

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#0f172a] text-white">
                <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
                    <p className="text-slate-400 font-medium animate-pulse">Initializing Purchasing ERP...</p>
                </div>
            </div>
        );
    }

    const renderContent = () => {
        switch (currentView) {
            case 'Dashboard':
                return <Dashboard />;
            case 'Inventory Forecasting':
                return <InventoryForecasting
                    isSidebarCollapsed={isSidebarCollapsed}
                    onNavigate={(v: ViewType) => setCurrentView(v)}
                    setHighlightDraftId={setHighlightDraftId}
                    refreshDrafts={() => fetchAllData(true)}
                />;
            case 'Draft Orders':
                return <DraftOrdersTable
                    purchaseOrders={purchaseOrders}
                    setPurchaseOrders={setPurchaseOrders}
                    drafts={drafts}
                    setDrafts={setDrafts}
                    skus={skus}
                    addSku={addSku}
                    vendors={vendors}
                    vendorMasters={vendorMasters}
                    onNavigate={(v: ViewType) => setCurrentView(v)}
                    onRefreshPOs={() => fetchAllData(true)}
                    highlightDraftId={highlightDraftId}
                    setHighlightDraftId={setHighlightDraftId}
                    onRefreshDrafts={() => fetchAllData(true)}
                />;
            case 'Purchase Orders':
                return <PurchaseOrders onNavigate={(v: ViewType) => setCurrentView(v)} />;
            case 'Vendor Shipments':
                return <VendorShipments
                    onNavigate={(v: ViewType | string) => setCurrentView(v as ViewType)}
                    vendorMasters={vendorMasters}
                    productMasterList={skus}
                />;
            case 'Shipment Tracker':
                return <ShipmentTracker onNavigateToBatch={(id) => {
                    setSelectedBatchId(id);
                    setCurrentView('Batch Detail');
                }} />;
            case 'Batch Detail':
                return selectedBatchId ? (
                    <BatchDetail
                        batchId={selectedBatchId}
                        onBack={() => setCurrentView('Shipment Tracker')}
                    />
                ) : <ShipmentTracker onNavigateToBatch={(id) => {
                    setSelectedBatchId(id);
                    setCurrentView('Batch Detail');
                }} />;
            case 'Finance':
                return <Finance
                    invoices={invoices}
                    vendors={vendors}
                    purchaseOrders={purchaseOrders}
                    shipments={shipments}
                    addInvoice={addInvoice}
                    updateInvoice={updateInvoice}
                    updateMultipleInvoices={updateMultipleInvoices}
                    addVendor={addVendor}
                    updateVendor={updateVendor}
                />;
            case 'Shipment Finance':
                return <ShipmentFinance onNavigateToDetail={(id) => {
                    setSelectedFinanceBatchId(id);
                    setCurrentView('Shipment Finance Detail');
                }} />;
            case 'Shipment Finance Detail':
                return selectedFinanceBatchId ? (
                    <ShipmentFinanceDetail
                        batchId={selectedFinanceBatchId}
                        onBack={() => setCurrentView('Shipment Finance')}
                    />
                ) : <ShipmentFinance onNavigateToDetail={(id) => {
                    setSelectedFinanceBatchId(id);
                    setCurrentView('Shipment Finance Detail');
                }} />;
            case 'Payment Ledger':
                return <PaymentLedger />;
            case 'Accounts View':
                return <AccountsView onNavigateToDetail={(id) => {
                    setSelectedFinanceBatchId(id);
                    setCurrentView('Shipment Finance Detail');
                }} />;
            case 'Inventory Analytics':
                return <InventoryAnalytics />;
            case 'Amazon Forecasting':
                return <AmazonForecasting
                    amazonConfig={amazonConfig}
                    onConfigUpdate={fetchAmazonConfig}
                />;
            case 'Create SKU':
                return <NewSkuDashboard
                    onOpenDetail={(id) => {
                        setSelectedSkuRequestId(id);
                        setCurrentView('SKU Detail');
                    }}
                    cachedData={skuRequests}
                    onDataLoaded={(data) => {
                        setSkuRequests(data);
                        setSkuRequestsLoaded(true);
                    }}
                    dataLoaded={skuRequestsLoaded}
                />;
            case 'SKU Detail':
                return selectedSkuRequestId ? (
                    <NewSkuDetail
                        requestId={selectedSkuRequestId}
                        onBack={() => setCurrentView('Create SKU')}
                    />
                ) : <NewSkuDashboard
                    onOpenDetail={(id) => {
                        setSelectedSkuRequestId(id);
                        setCurrentView('SKU Detail');
                    }}
                    cachedData={skuRequests}
                    onDataLoaded={(data) => {
                        setSkuRequests(data);
                        setSkuRequestsLoaded(true);
                    }}
                    dataLoaded={skuRequestsLoaded}
                />;
            case 'Settings':
                return <Settings
                    config={forecastingConfig}
                    onRefreshConfig={fetchConfig}
                    lastLoaded={configLastLoaded}
                    amazonConfig={amazonConfig}
                    onRefreshAmazonConfig={fetchAmazonConfig}
                    amazonConfigLastLoaded={amazonConfigLastLoaded}
                />;
            default:
                return <Dashboard />;
        }
    };

    return (
        <div className="flex h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
            <Sidebar
                currentView={currentView}
                setView={setCurrentView}
                isCollapsed={isSidebarCollapsed}
                setIsCollapsed={setIsSidebarCollapsed}
                user={user}
            />
            <div className={`flex-1 flex flex-col transition-all duration-300 ${isSidebarCollapsed ? 'ml-20' : 'ml-64'}`}>
                <Header
                    currentView={currentView}
                    notifications={notifications}
                    setNotifications={setNotifications}
                    user={user}
                    onLogout={handleLogout}
                />
                <main className="flex-1 p-0 overflow-y-auto">
                    {renderContent()}
                </main>

                {/* Global Debug Panel */}
                <div className="fixed bottom-4 right-4 z-[200]">
                    <button
                        onClick={() => setShowGlobalDebug(!showGlobalDebug)}
                        className="bg-slate-800 border border-slate-700 p-2 rounded-full shadow-lg hover:bg-slate-700 transition-all text-slate-400 hover:text-white"
                        title="Toggle Debug Mode"
                    >
                        🐛
                    </button>

                    {showGlobalDebug && (
                        <div className="absolute bottom-12 right-0 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-4 overflow-hidden animate-in slide-in-from-bottom-2">
                            <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-3 border-b border-slate-800 pb-2">Internal Debug Panel</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-500 font-medium">Active Tab:</span>
                                    <span className="text-white bg-blue-500/20 px-2 py-0.5 rounded font-mono">{currentView}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-500 font-medium">Highlight Draft ID:</span>
                                    <span className="text-white bg-amber-500/20 px-2 py-0.5 rounded font-mono">{highlightDraftId || 'null'}</span>
                                </div>
                                <div className="border-t border-slate-800 pt-2">
                                    <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">User Info</p>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500 font-medium">Email:</span>
                                        <span className="text-white font-mono">{user?.email || 'N/A'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500 font-medium">Role:</span>
                                        <span className="text-white font-mono">{user?.role || 'N/A'}</span>
                                    </div>
                                    <div className="flex flex-col text-xs mt-1">
                                        <span className="text-slate-500 font-medium whitespace-nowrap">Allowed Tabs:</span>
                                        <span className="text-white font-mono text-[9px] break-all">{user?.allowedTabs?.join(', ') || 'None'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs mt-1">
                                        <span className="text-slate-500 font-medium">Session Age:</span>
                                        <span className="text-white font-mono">{user?.loggedInAt ? Math.floor((Date.now() - user.loggedInAt) / 60000) + ' min' : 'N/A'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500 font-medium">Expiry In:</span>
                                        <span className="text-white font-mono">{user?.loggedInAt ? Math.max(0, Math.floor((8 * 60 * 60 * 1000 - (Date.now() - user.loggedInAt)) / 60000)) + ' min' : 'N/A'}</span>
                                    </div>
                                </div>
                                <div className="border-t border-slate-800 pt-2">
                                    <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">Last API Call</p>
                                    <div className="bg-slate-950 p-2 rounded border border-slate-800 font-mono text-[10px] text-slate-400">
                                        {lastApiLog ? (
                                            <>
                                                <div className="flex justify-between">
                                                    <span className="text-green-400">{lastApiLog.action}</span>
                                                    <span className="text-blue-400">HTTP {lastApiLog.status}</span>
                                                </div>
                                                <div className="mt-1 text-slate-500 text-[9px]">{lastApiLog.timestamp}</div>
                                            </>
                                        ) : 'No calls recorded'}
                                    </div>
                                </div>
                                <div className="flex justify-between items-center text-[10px]">
                                    <span className="text-slate-500 uppercase font-bold">Drafts Refreshed:</span>
                                    <span className="text-slate-400">{lastRefreshTime}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowGlobalDebug(false)}
                                className="w-full mt-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-white transition-colors border-t border-slate-800"
                            >
                                Close Debug
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default App;