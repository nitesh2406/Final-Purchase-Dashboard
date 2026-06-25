import { executeAppsScriptProxy } from './settlementService';
import { APPS_SCRIPT_URL } from '../constants';

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface QueueItem {
  id: string; // unique ID to track item (can match invoiceId, paymentId, adjustment payload id, or vendor_id)
  type: 'purchase' | 'payment' | 'adjustment' | 'vendor_create';
  payload: any;
  status: QueueStatus;
  error?: string;
  timestamp: number;
}

type SyncCallback = (queue: QueueItem[]) => void;
type SuccessCallback = (type: 'purchase' | 'payment' | 'adjustment' | 'vendor_create', payload: any) => Promise<void>;

class QueueSyncManager {
  private queue: QueueItem[] = [];
  private listeners: Set<SyncCallback> = new Set();
  private successCallbacks: Set<SuccessCallback> = new Set();
  private isProcessing: boolean = false;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('erp_sync_queue');
      if (saved) {
        const loaded: QueueItem[] = JSON.parse(saved);
        // Retain only columns that are pending, syncing, or failed (exclude synced items or items older than 3 days)
        const active = loaded.filter(
          (q) => q.status !== 'synced' && Date.now() - q.timestamp < 3 * 24 * 60 * 60 * 1000
        );
        // If an item was left as 'syncing' during load, revert to 'pending' to retry
        this.queue = active.map((q) =>
          q.status === 'syncing' ? { ...q, status: 'pending' as const } : q
        );
      }
    } catch (e) {
      console.error('Failed to parse saved sync queue:', e);
      this.queue = [];
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('erp_sync_queue', JSON.stringify(this.queue));
    } catch (e) {
      console.error('Failed to save sync queue:', e);
    }
  }

  public getQueue(): QueueItem[] {
    return this.queue;
  }

  public subscribe(cb: SyncCallback): () => void {
    this.listeners.add(cb);
    // Instant initial trigger
    cb(this.queue);
    return () => this.listeners.delete(cb);
  }

  public registerSuccessCallback(cb: SuccessCallback) {
    this.successCallbacks.add(cb);
  }

  private notify() {
    this.saveToStorage();
    this.listeners.forEach((cb) => cb([...this.queue]));
  }

  public add(
    id: string,
    type: 'purchase' | 'payment' | 'adjustment' | 'vendor_create',
    payload: any
  ) {
    // Avoid double-queueing the same active item
    const exists = this.queue.some((q) => q.id === id && q.status !== 'synced');
    if (exists) {
      console.warn(`Item ${id} is already in the sync queue as active.`);
      return;
    }

    const newItem: QueueItem = {
      id,
      type,
      payload,
      status: 'pending',
      timestamp: Date.now()
    };

    this.queue.push(newItem);
    this.notify();

    // Start running the queue immediately
    this.processQueue();
  }

  public retry(id: string) {
    const item = this.queue.find((q) => q.id === id);
    if (item) {
      item.status = 'pending';
      item.error = undefined;
      this.notify();
      this.processQueue();
    }
  }

  public dismiss(id: string): boolean {
    const item = this.queue.find((q) => q.id === id);
    if (!item) return false;

    // Cannot dismiss items that are currently in flight
    if (item.status === 'syncing') {
      return false;
    }

    this.queue = this.queue.filter((q) => q.id !== id);
    this.notify();
    return true;
  }

  public dismissAll() {
    // Remove all items that are not currently syncing
    this.queue = this.queue.filter((q) => q.status === 'syncing');
    this.notify();
  }

  public clearSynced() {
    // Clear out synced items from display to keep things squeaky clean
    this.queue = this.queue.filter((q) => q.status !== 'synced');
    this.notify();
  }

  private async processQueue() {
    if (this.isProcessing) return;
    
    // Find first non-synced item
    const current = this.queue.find((q) => q.status === 'pending');
    if (!current) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    current.status = 'syncing';
    this.notify();

    try {
      console.log(`[Queue Runner] Processing sequence: ${current.type} -> ID: ${current.id}`);
      
      const res = await this.executeItem(current);
      
      if (res && (res.status === 'success' || res.success === true)) {
        console.log(`[Queue Runner] Succeeded for: ${current.id}`);
        current.status = 'synced';
        current.error = undefined;
        this.notify();

        // Trigger corresponding success callbacks/table silent refreshes on App.tsx
        for (const cb of this.successCallbacks) {
          try {
            await cb(current.type, current.payload);
          } catch (callbackErr) {
            console.error('[Queue Runner] Success callback hydration error:', callbackErr);
          }
        }

        // Defer next item slightly for stability
        this.isProcessing = false;
        setTimeout(() => this.processQueue(), 250);
      } else {
        throw new Error(res?.message || 'Apps Script returned non-success response');
      }
    } catch (err: any) {
      console.error(`[Queue Runner] Error processing ${current.id}:`, err);
      current.status = 'failed';
      current.error = err.message || String(err);
      this.notify();

      // IMPORTANT constraint: STOP execution on failure to preserve sequential transactional order!
      this.isProcessing = false;
    }
  }

  private async executeItem(item: QueueItem): Promise<any> {
    const appsScriptUrl = APPS_SCRIPT_URL;
    const payload = item.payload;

    switch (item.type) {
      case 'purchase': {
        const tableRecord = {
          date: payload.date,
          invoiceId: payload.invoiceId,
          vendorCode: payload.vendorCode,
          rmb: payload.rmb,
          notes: payload.notes || undefined,
          status: 'Pending EOD',
          settledAmount: 0,
          balance: payload.rmb
        };
        return await executeAppsScriptProxy(appsScriptUrl, 'insert_purchase_invoice', 'PurchaseInvoices', 'POST', { record: tableRecord });
      }

      case 'payment': {
        return await executeAppsScriptProxy(appsScriptUrl, 'insert_payment_log', 'PaymentLogs', 'POST', {
          record: {
            'Payment ID': payload.paymentId,
            'Date': payload.date,
            'Vendor Code': payload.vendorCode,
            'RMB Amount': payload.rmbAmount,
            'RMB': payload.rmbAmount,
            'ER2': payload.fxRate,
            'INR Amount': payload.inrAmount,
            'INR': payload.inrAmount,
            'Payment Mode': payload.paymentMode || '',
            'Reference No': payload.referenceNo || '',
            'Allocations': payload.allocations ? JSON.stringify(payload.allocations) : '',
            'Balance': payload.rmbAmount,
            allocations: payload.allocations || [],
            isCrossVendor: payload.isCrossVendor || false
          }
        });
      }

      case 'adjustment': {
        return await executeAppsScriptProxy(appsScriptUrl, 'add_adjustment_entry', 'SettlementLedger', 'POST', { record: payload });
      }

      case 'vendor_create': {
        return await executeAppsScriptProxy(appsScriptUrl, 'insert_vendor_account', 'VendorAccounts', 'POST', { record: payload });
      }

      default:
        throw new Error(`Invalid item type in queue: ${item.type}`);
    }
  }
}

export const SyncQueueManager = new QueueSyncManager();
if (typeof window !== 'undefined') {
  (window as any).SyncQueueManager = SyncQueueManager;
}
