import React, { useState, useEffect, useCallback } from 'react';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { Header } from './components/layout/Header.tsx';
import { Dashboard } from './components/dashboard/Dashboard.tsx';
import {
    PurchaseInvoice,
    PaymentLog,
    SettlementRecord,
    VendorLedgerEntry,
    fetchPurchaseInvoices,
    fetchPaymentLogs,
    fetchSettlementRecords,
    fetchVendorLedger,
    fetchVendorAccounts,
    syncInvoicesFromShipments,
    IS_DEVELOPMENT_MODE
} from './services/settlementService.ts';
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
import { SettlementLedger } from './components/finance/SettlementLedger.tsx';
import { Sku, PurchaseOrder, Shipment, Invoice, Vendor, Notification, DraftOrder, VendorMaster } from './types.ts';
import { APPS_SCRIPT_URL, API_ACTIONS } from './constants.ts';
import { ViewType } from './types';
import { SkeletonDashboard } from './components/feedback/SkeletonDashboard.tsx';
import { SyncQueueManager, QueueItem } from './services/syncQueue.ts';

const TEST_LOGIN_BYPASS = false;
const DEV_USER = TEST_LOGIN_BYPASS ? { name: 'Dev User', email: 'dev@local', role: 'ADMIN', loggedInAt: Date.now() } : null;

const App: React.FC = () => {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [currentView, setCurrentView] = useState<ViewType>('Dashboard');
    const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
    const [selectedFinanceBatchId, setSelectedFinanceBatchId] = useState<string | null>(null);
    const [selectedSkuRequestId, setSelectedSkuRequestId] = useState<string | null>(null);
    const [skuRequests, setSkuRequests] = useState<any[]>([]);
    const [skuRequestsLoaded, setSkuRequestsLoaded] = useState(false);
    const [skuStatusFilter, setSkuStatusFilter] = useState<string>('PENDING');
    const [skuVendorFilter, setSkuVendorFilter] = useState<string>('ALL');
    const [skuDateFrom, setSkuDateFrom] = useState<string>('');
    const [skuDateTo, setSkuDateTo] = useState<string>('');
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

    // Financial Data State
    const [purchaseInvoices, setPurchaseInvoices] = useState<(PurchaseInvoice & { temp?: boolean })[]>([]);
    const [paymentLogs, setPaymentLogs] = useState<(PaymentLog & { temp?: boolean })[]>([]);
    const [settlementRecords, setSettlementRecords] = useState<(SettlementRecord & { temp?: boolean })[]>([]);
    const [vendorLedger, setVendorLedger] = useState<VendorLedgerEntry[]>([]);
    const [isSyncingShipments, setIsSyncingShipments] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [syncSuccess, setSyncSuccess] = useState(false);

    const [isLoading, setIsLoading] = useState(true);
    const [purchaseDataLoaded, setPurchaseDataLoaded] = useState(false);
    const [paymentDataLoaded, setPaymentDataLoaded] = useState(false);
    const [vendorDataLoaded, setVendorDataLoaded] = useState(false);
    const [shipmentsDataLoaded, setShipmentsDataLoaded] = useState(false);

    const isInitialDataLoaded = purchaseDataLoaded && paymentDataLoaded && vendorDataLoaded && shipmentsDataLoaded;

    const [queue, setQueue] = useState<QueueItem[]>(SyncQueueManager.getQueue());

    const [forecastingConfig, setForecastingConfig] = useState<any>(null);
    const [configLastLoaded, setConfigLastLoaded] = useState<Date | null>(null);
    const [amazonConfig, setAmazonConfig] = useState<any>(null);
    const [amazonConfigLastLoaded, setAmazonConfigLastLoaded] = useState<Date | null>(null);

    const [user, setUser] = useState<any>(() => {
        if (TEST_LOGIN_BYPASS) return DEV_USER;
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

    // Session expiry check (every minute)
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
        }, 60000);
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

    useEffect(() => {
        (window as any).SyncQueueManager = SyncQueueManager;
    }, []);

    useEffect(() => {
        const unsubscribe = SyncQueueManager.subscribe((newQueue) => {
            setQueue(newQueue);
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        SyncQueueManager.registerSuccessCallback(async (type, _payload) => {
            console.log(`[Sync Queue Targeted Sync Callback] Silent table refresh trigger for: ${type}`);
            if (type === 'purchase') {
                const refreshedInvoices = await fetchPurchaseInvoices();
                setPurchaseInvoices(refreshedInvoices);
            } else if (type === 'payment') {
                const [refreshedPayments, refreshedLedger] = await Promise.all([
                    fetchPaymentLogs(),
                    fetchVendorLedger()
                ]);
                setPaymentLogs(refreshedPayments);
                setVendorLedger(refreshedLedger);
            } else if (type === 'adjustment') {
                const [refreshedLedger, refreshedSettlements] = await Promise.all([
                    fetchVendorLedger(),
                    fetchSettlementRecords()
                ]);
                setVendorLedger(refreshedLedger);
                setSettlementRecords(refreshedSettlements);
            } else if (type === 'vendor_create') {
                const refreshedMasters = await fetchVendorAccounts();
                setVendorMasters(refreshedMasters);
            }
        });
    }, []);

    // Derived memoized views merging sheet database with local optimistic queue rows
    const displayPurchaseInvoices = React.useMemo(() => {
        const list = [...purchaseInvoices];
        queue.forEach(q => {
            if (q.type === 'purchase') {
                if (q.status === 'synced') return;
                const payload = q.payload;
                const idx = list.findIndex(inv => String(inv.invoiceId).trim().toLowerCase() === String(payload.invoiceId).trim().toLowerCase());
                const optimisticItem = {
                    date: payload.date,
                    invoiceId: payload.invoiceId,
                    vendorCode: payload.vendorCode,
                    rmb: payload.rmb,
                    notes: payload.notes || 'Sync pending...',
                    status: 'Pending EOD' as const,
                    settledAmount: 0,
                    balance: payload.rmb,
                    syncStatus: q.status,
                    syncError: q.error,
                    queueId: q.id
                };
                if (idx !== -1) {
                    list[idx] = { ...list[idx], ...optimisticItem };
                } else {
                    list.unshift(optimisticItem);
                }
            }
        });
        return list;
    }, [purchaseInvoices, queue]);

    const displayPaymentLogs = React.useMemo(() => {
        const list = [...paymentLogs];
        queue.forEach(q => {
            if (q.type === 'payment') {
                if (q.status === 'synced') return;
                const payload = q.payload;
                const idx = list.findIndex(p => String(p.paymentId).trim().toLowerCase() === String(payload.paymentId).trim().toLowerCase());
                const optimisticItem = {
                    paymentId: payload.paymentId,
                    date: payload.date,
                    vendorCode: payload.vendorCode,
                    rmbAmount: payload.rmbAmount,
                    fxRate: payload.fxRate,
                    inrAmount: payload.inrAmount,
                    paymentMode: payload.paymentMode || '',
                    referenceNo: payload.referenceNo || '',
                    balance: payload.rmbAmount,
                    syncStatus: q.status,
                    syncError: q.error,
                    queueId: q.id
                };
                if (idx !== -1) {
                    list[idx] = { ...list[idx], ...optimisticItem };
                } else {
                    list.unshift(optimisticItem);
                }
            }
        });
        return list;
    }, [paymentLogs, queue]);

    const displaySettlementRecords = React.useMemo(() => {
        const list = [...settlementRecords];
        queue.forEach(q => {
            if (q.type === 'adjustment') {
                if (q.status === 'synced') return;
                const payload = q.payload;
                const idx = list.findIndex(s => String(s.id).trim().toLowerCase() === String(q.id).trim().toLowerCase());
                const optimisticItem = {
                    id: q.id,
                    date: payload.date,
                    invoiceId: payload.invoiceId,
                    vendorNo: payload.vendorNo,
                    vendorName: payload.vendorName,
                    txnType: payload.txnType,
                    amountRmb: payload.amountRmb,
                    amountInr: payload.amountInr,
                    exchangeRatePrimary: payload.exchangeRatePrimary,
                    exchangeRateSettlement: payload.exchangeRateSettlement,
                    forexGainLoss: payload.forexGainLoss,
                    notes: payload.notes || 'Sync pending...',
                    paymentId: payload.paymentId || '',
                    syncStatus: q.status,
                    syncError: q.error,
                    queueId: q.id
                };
                if (idx !== -1) {
                    list[idx] = { ...list[idx], ...optimisticItem };
                } else {
                    list.unshift(optimisticItem);
                }
            }
        });
        return list;
    }, [settlementRecords, queue]);

    const displayVendorMasters = React.useMemo(() => {
        const list = [...vendorMasters];
        queue.forEach(q => {
            if (q.type === 'vendor_create') {
                if (q.status === 'synced') return;
                const payload = q.payload;
                const idx = list.findIndex(v => String(v.vendor_id).trim().toLowerCase() === String(payload.vendor_id).trim().toLowerCase());
                const optimisticItem = {
                    vendor_id: payload.vendor_id,
                    vendor_name: payload.vendor_name,
                    currency: payload.currency || 'RMB',
                    country: payload.country || '',
                    payment_terms: payload.payment_terms || '',
                    is_active: true,
                    syncStatus: q.status,
                    syncError: q.error,
                    queueId: q.id
                };
                if (idx !== -1) {
                    list[idx] = { ...list[idx], ...optimisticItem };
                } else {
                    list.unshift(optimisticItem);
                }
            }
        });
        return list;
    }, [vendorMasters, queue]);

    const fetchAllData = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        setIsSyncing(true);
        setSyncSuccess(false);
        setSyncError(null);
        try {
            const fetchDirect = async (payload: any) => {
                try {
                    const res = await fetch(APPS_SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify(payload)
                    });

                    const rawText = await res.text();

                    if (!res.ok) {
                        console.warn(`Fetch error status ${res.status}`);
                        return { status: 'error', message: `Fetch error status ${res.status}` };
                    }

                    try {
                        return JSON.parse(rawText);
                    } catch (e) {
                        console.warn("Failed to parse response as JSON:", rawText);
                        return { status: 'error', message: 'Response was not JSON' };
                    }
                } catch (err: any) {
                    console.warn(`fetchDirect failed for ${payload.action}:`, err.message);
                    return { status: 'error', message: err.message };
                }
            };

            const draftsPromise = fetchDirect({ action: API_ACTIONS.GET_DRAFTS });

            const otherEndpoints = ['skus', 'pos', 'shipments', 'invoices', 'vendors', 'notifications', 'vendor_masters'];
            const otherPromises = otherEndpoints.map(e => fetchDirect({ action: 'get_' + e }));

            const [draftsResponse, ...otherResponses] = await Promise.all([draftsPromise, ...otherPromises]);
            const [skusData, posData, shpData, invData, venData, notifData, venMastersData] = otherResponses;

            setLastApiLog({ action: 'GET_ALL_DATA', status: 200, timestamp: new Date().toLocaleTimeString() });
            setLastRefreshTime(new Date().toLocaleTimeString());

            if (draftsResponse && draftsResponse.drafts) {
                setDrafts(draftsResponse.drafts);
            }

            if (skusData?.skus) setSkus(skusData.skus);
            if (posData?.pos) setPurchaseOrders(posData.pos);
            if (shpData?.shipments) setShipments(shpData.shipments);
            if (invData?.invoices) setInvoices(invData.invoices);
            if (venData?.vendors) setVendors(venData.vendors);
            if (notifData?.notifications) setNotifications(notifData.notifications);
            if (venMastersData?.vendors) setVendorMasters(venMastersData.vendors);

            // Fetch Financial Data
            const finInvoicesPromise = fetchPurchaseInvoices();
            const rawShipmentsPromise = fetchDirect({ action: 'get_vendor_shipments' }).catch(err => {
                console.warn('Failed to fetch raw Vendor_Shipments sheet:', err);
                return { status: 'error', records: [] };
            });

            const [
                finInvoices,
                rawShipmentsRes,
                finPayments,
                finSettlements,
                finVendorLedger,
                masters
            ] = await Promise.all([
                finInvoicesPromise,
                rawShipmentsPromise,
                fetchPaymentLogs(),
                fetchSettlementRecords(),
                fetchVendorLedger(),
                fetchVendorAccounts(),
            ]);

            const rawShipments = (rawShipmentsRes && rawShipmentsRes.status === 'success' && Array.isArray(rawShipmentsRes.records))
                ? rawShipmentsRes.records
                : [];

            setVendorMasters(masters);
            setVendorLedger(finVendorLedger);

            const lastEodSuccess = localStorage.getItem('last_eod_success_time');
            const isCacheActive = false;

            if (lastEodSuccess && !isCacheActive) {
                localStorage.removeItem('last_eod_success_time');
            }

            let mergedInvoices = [...finInvoices];

            const existingInvoiceIds = new Set(mergedInvoices.map((inv: any) => String(inv.invoiceId).trim()));
            const optimisticInvoices: any[] = [];

            if (!IS_DEVELOPMENT_MODE) {
                rawShipments.forEach((ship: any) => {
                    const invoiceId = String(ship.invoice_no || ship.invoiceId || ship['Invoice ID'] || ship.InvoiceId || '').trim();
                    if (!invoiceId || invoiceId === '' || invoiceId === 'undefined' || invoiceId === 'null' || existingInvoiceIds.has(invoiceId)) {
                        return;
                    }

                    const date = ship.invoice_date || ship['Invoice Date'] || ship.Date || new Date().toISOString().split('T')[0];
                    const vendorCode = ship.VendorCode || ship['Vendor Code'] || ship.vendor_code || '';
                    const rmb = parseFloat(ship.RMB || '0') || 0;

                    optimisticInvoices.push({
                        date,
                        invoiceId,
                        vendorCode,
                        rmb,
                        notes: 'Auto-Ingested from Shipments (In-Flight Sync)',
                        er1: undefined,
                        inr: undefined,
                        status: 'Pending EOD',
                        settledAmount: 0,
                        balance: rmb,
                        temp: true,
                        createdAtTimestamp: Date.now()
                    });
                });
            }

            if (IS_DEVELOPMENT_MODE) {
                setPurchaseInvoices(mergedInvoices);
            } else {
                setPurchaseInvoices(prev => {
                    const remoteIds = new Set(mergedInvoices.map(i => i.invoiceId ? String(i.invoiceId).trim().toLowerCase() : ''));
                    const remainingTemp = IS_DEVELOPMENT_MODE ? [] : prev.filter(i => {
                        if (!i.temp) return false;
                        const key = i.invoiceId ? String(i.invoiceId).trim().toLowerCase() : '';
                        return !remoteIds.has(key);
                    });

                    const finalInvoices = [...remainingTemp, ...optimisticInvoices, ...mergedInvoices];
                    const uniqueInvoicesMap = new Map();
                    finalInvoices.forEach(inv => {
                        const key = inv && inv.invoiceId ? String(inv.invoiceId).trim().toLowerCase() : '';
                        if (key) {
                            uniqueInvoicesMap.set(key, inv);
                        }
                    });
                    return Array.from(uniqueInvoicesMap.values());
                });
            }

            if (IS_DEVELOPMENT_MODE) {
                setPaymentLogs(finPayments);
            } else {
                setPaymentLogs(prev => {
                    const remoteIds = new Set(finPayments.map(p => p.paymentId ? String(p.paymentId).trim().toLowerCase() : ''));
                    const remainingTemp = prev.filter(p => {
                        if (!p.temp) return false;
                        const key = p.paymentId ? String(p.paymentId).trim().toLowerCase() : '';
                        return !remoteIds.has(key);
                    });
                    const finalPayments = [...remainingTemp, ...finPayments];
                    const uniquePaymentsMap = new Map();
                    finalPayments.forEach(p => {
                        const key = p && p.paymentId ? String(p.paymentId).trim().toLowerCase() : '';
                        if (key) {
                            uniquePaymentsMap.set(key, p);
                        }
                    });
                    return Array.from(uniquePaymentsMap.values());
                });
            }

            if (IS_DEVELOPMENT_MODE) {
                setSettlementRecords(finSettlements);
            } else {
                setSettlementRecords(prev => {
                    const remoteIds = new Set(finSettlements.map(s => s.id ? String(s.id).trim().toLowerCase() : ''));
                    const remainingTemp = prev.filter(s => {
                        if (!s.temp) return false;
                        const key = s.id ? String(s.id).trim().toLowerCase() : '';
                        return !remoteIds.has(key);
                    });
                    const finalSettlements = [...remainingTemp, ...finSettlements];
                    const uniqueSettlementsMap = new Map();
                    finalSettlements.forEach(s => {
                        const key = s && s.id ? String(s.id).trim().toLowerCase() : '';
                        if (key) {
                            uniqueSettlementsMap.set(key, s);
                        }
                    });
                    return Array.from(uniqueSettlementsMap.values());
                });
            }

            setIsSyncingShipments(true);
            const syncPromise = syncInvoicesFromShipments();

            syncPromise.then(async () => {
                const refreshedInvoices = await fetchPurchaseInvoices();
                setIsSyncingShipments(false);
                setPurchaseInvoices(refreshedInvoices);
                setShipmentsDataLoaded(true);
            }).catch(err => {
                console.error("Silent background sync refresh failed:", err);
                setIsSyncingShipments(false);
                setShipmentsDataLoaded(true);
            });

            setPurchaseDataLoaded(true);
            setPaymentDataLoaded(true);
            setVendorDataLoaded(true);

            setSyncSuccess(true);
            setIsSyncing(false);
            setTimeout(() => setSyncSuccess(false), 4500);
        } catch (err: any) {
            console.error("Critical error fetching dashboard data:", err);
            setSyncError(err?.message || String(err));
            setIsSyncing(false);
            setPurchaseDataLoaded(true);
            setPaymentDataLoaded(true);
            setVendorDataLoaded(true);
            setShipmentsDataLoaded(true);
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

    if (!user && !TEST_LOGIN_BYPASS) {
        return <LoginPage onLoginSuccess={handleLoginSuccess} />;
    }

    if (!isInitialDataLoaded) {
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
                        <SkeletonDashboard />
                    </main>
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
                return <PaymentLedger
                    onNavigate={(v) => setCurrentView(v)}
                    vendors={displayVendorMasters}
                    onRefresh={() => fetchAllData(true)}
                />;
            case 'Settlement Ledger':
                return <SettlementLedger
                    invoices={displayPurchaseInvoices}
                    paymentLogs={displayPaymentLogs}
                    settlementRecords={displaySettlementRecords}
                    vendors={displayVendorMasters}
                    onNavigate={(v) => setCurrentView(v)}
                    onRefresh={() => fetchAllData(true)}
                    setSettlementRecords={setSettlementRecords}
                    setPurchaseInvoices={setPurchaseInvoices}
                />;
            case 'Accounts View':
                return <AccountsView
                    invoices={displayPurchaseInvoices}
                    paymentLogs={displayPaymentLogs}
                    vendorLedger={vendorLedger}
                    vendors={displayVendorMasters}
                    onNavigateToDetail={(id) => {
                        setSelectedFinanceBatchId(id);
                        setCurrentView('Shipment Finance Detail');
                    }}
                    onNavigate={(v) => setCurrentView(v)}
                    onRefresh={() => fetchAllData(true)}
                    setPurchaseInvoices={setPurchaseInvoices}
                    setPaymentLogs={setPaymentLogs}
                    isSyncingShipments={isSyncingShipments}
                    isSyncing={isSyncing}
                    syncSuccess={syncSuccess}
                    syncError={syncError}
                />;
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
                    statusFilter={skuStatusFilter}
                    onStatusFilterChange={setSkuStatusFilter}
                    vendorFilter={skuVendorFilter}
                    onVendorFilterChange={setSkuVendorFilter}
                    dateFrom={skuDateFrom}
                    onDateFromChange={setSkuDateFrom}
                    dateTo={skuDateTo}
                    onDateToChange={setSkuDateTo}
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
                    statusFilter={skuStatusFilter}
                    onStatusFilterChange={setSkuStatusFilter}
                    vendorFilter={skuVendorFilter}
                    onVendorFilterChange={setSkuVendorFilter}
                    dateFrom={skuDateFrom}
                    onDateFromChange={setSkuDateFrom}
                    dateTo={skuDateTo}
                    onDateToChange={setSkuDateTo}
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
            </div>

            {/* Global Debug Panel */}
            <div className="fixed bottom-4 left-4 z-[200]">
                <button
                    onClick={() => setShowGlobalDebug(!showGlobalDebug)}
                    className="bg-slate-800 border border-slate-700 p-2 rounded-full shadow-lg hover:bg-slate-700 transition-all text-slate-400 hover:text-white"
                    title="Toggle Debug Mode"
                >
                    🐛
                </button>

                {showGlobalDebug && (
                    <div className="absolute bottom-12 left-0 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-4 overflow-hidden animate-in slide-in-from-bottom-2">
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

            {/* Sync Status Floating Banner */}
            {queue.filter(q => q.status !== 'synced').length > 0 && (
                <div className="fixed bottom-6 right-6 z-50 bg-white/95 dark:bg-slate-950/95 text-slate-800 dark:text-white shadow-2xl border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-3 max-w-sm w-80 animate-slide-up backdrop-blur-md">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {queue.some(q => q.status === 'syncing') ? (
                                <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                            ) : queue.some(q => q.status === 'pending') ? (
                                <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse" />
                            ) : queue.some(q => q.status === 'failed') ? (
                                <div className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse" />
                            ) : (
                                <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                            )}
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-550 dark:text-slate-400">Ledger Sync Engine</span>
                        </div>
                        <button
                            onClick={() => SyncQueueManager.dismissAll()}
                            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors underline cursor-pointer"
                        >
                            Dismiss Sync
                        </button>
                    </div>

                    <div>
                        {(() => {
                            const pendingCount = queue.filter(q => q.status === 'pending').length;
                            const syncingCount = queue.filter(q => q.status === 'syncing').length;
                            const failedCount = queue.filter(q => q.status === 'failed').length;
                            const activeCount = pendingCount + syncingCount;

                            if (activeCount > 0) {
                                return (
                                    <div>
                                        <p className="text-sm font-semibold text-slate-800 dark:text-white">
                                            Syncing {activeCount} change{activeCount > 1 ? 's' : ''}...
                                        </p>
                                        <p className="text-[11px] text-slate-550 dark:text-slate-400 mt-0.5">
                                            Synchronizing ledgers sequentially with Google Sheets secure server.
                                        </p>
                                    </div>
                                );
                            } else if (failedCount > 0) {
                                return (
                                    <div>
                                        <p className="text-sm font-semibold text-rose-400">
                                            ⚠️ Sync failed ({failedCount} action{failedCount > 1 ? 's' : ''})
                                        </p>
                                        <p className="text-[11px] text-slate-550 dark:text-slate-400 mt-0.5">
                                            Click retry on individual elements below to resume the sequence.
                                        </p>
                                    </div>
                                );
                            } else {
                                return (
                                    <div>
                                        <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                                            ✓ All changes synced
                                        </p>
                                        <p className="text-[11px] text-slate-550 dark:text-slate-400 mt-0.5">
                                            Synced, local table records reconciled successfully.
                                        </p>
                                    </div>
                                );
                            }
                        })()}
                    </div>

                    <div className="max-h-24 overflow-y-auto space-y-1.5 pr-1 border-t border-slate-200 dark:border-slate-800 pt-2.5 text-[11px]">
                        {queue.filter(q => q.status !== 'synced').slice(-3).map((q) => (
                            <div key={q.id} className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                                <span className="truncate max-w-[120px] font-medium font-mono text-[10.5px]">
                                    {q.type === 'purchase' ? `📄 ${q.payload.invoiceId}` : q.type === 'payment' ? `💳 ${q.payload.paymentId}` : q.type === 'vendor_create' ? `🏢 ${q.payload.vendor_id}` : `⚖️ ${q.payload.invoiceId || q.id}`}
                                </span>
                                <div className="flex items-center gap-1">
                                    <span className={`px-1.5 py-0.5 rounded-[4px] font-extrabold text-[9px] uppercase ${
                                        q.status === 'synced' ? 'bg-emerald-950 text-emerald-400' :
                                        q.status === 'failed' ? 'bg-rose-955/60 text-rose-400' :
                                        q.status === 'syncing' ? 'bg-blue-955/60 text-blue-400 animate-pulse' :
                                        'bg-amber-955/60 text-amber-400'
                                    }`}>
                                        {q.status}
                                    </span>

                                    <div className="flex items-center gap-1">
                                        {q.status === 'failed' && (
                                            <button
                                                onClick={() => SyncQueueManager.retry(q.id)}
                                                className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider transition-colors"
                                            >
                                                Retry
                                            </button>
                                        )}
                                        {q.status !== 'syncing' && q.status !== 'synced' && (
                                            <button
                                                onClick={() => SyncQueueManager.dismiss(q.id)}
                                                className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-extrabold px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider transition-colors"
                                                title="Cancel pending transaction"
                                            >
                                                Dismiss
                                            </button>
                                        )}
                                        {q.status === 'syncing' && (
                                            <span className="text-[8px] text-blue-500 font-black uppercase opacity-60">Locked</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
