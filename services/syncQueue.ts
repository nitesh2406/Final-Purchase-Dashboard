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
  autoRetryCount?: number; // how many times processQueue has auto-retried this item after a failure
}

// Kept when an item is dismissed or purged for staleness — a queued
// financial write should never just vanish with zero record of it having
// existed. Not a full undo log forever, just enough of a paper trail that
// "where did my payment go" has an answer.
export interface DismissedQueueItem extends QueueItem {
  removedAt: number;
  removedReason: 'dismissed' | 'dismissed_all' | 'stale_purge';
}

const DISMISSED_LOG_KEY = 'erp_sync_queue_dismissed_log';
const DISMISSED_LOG_MAX = 100;
const STALE_MS = 3 * 24 * 60 * 60 * 1000;
const RETRY_BACKOFF_MS = 30 * 1000; // base delay; exponential backoff from here
const MAX_AUTO_RETRIES = 5; // after this many auto-retries, a failed item waits for manual Retry

type SyncCallback = (queue: QueueItem[]) => void;
type SuccessCallback = (type: 'purchase' | 'payment' | 'adjustment' | 'vendor_create', payload: any) => Promise<void>;

class QueueSyncManager {
  private queue: QueueItem[] = [];
  private dismissedLog: DismissedQueueItem[] = [];
  private listeners: Set<SyncCallback> = new Set();
  private successCallbacks: Set<SuccessCallback> = new Set();
  private isProcessing: boolean = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromStorage();
    this.loadDismissedLog();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('erp_sync_queue');
      if (saved) {
        const loaded: QueueItem[] = JSON.parse(saved);
        const now = Date.now();

        // Items older than the staleness window are dropped, but — unlike
        // before — they're logged first, not silently discarded. A synced
        // item aging out is normal cleanup; a pending/failed item aging out
        // means a real queued write never made it, and that needs a record.
        const stale = loaded.filter((q) => q.status !== 'synced' && now - q.timestamp >= STALE_MS);
        if (stale.length > 0) {
          console.warn(
            `[Queue] ${stale.length} unsynced item(s) exceeded the ${STALE_MS / 86400000}-day retention window and were removed. Logged to getDismissedLog().`,
            stale.map((q) => ({ id: q.id, type: q.type, status: q.status }))
          );
          this.logDismissed(stale, 'stale_purge');
        }

        const active = loaded.filter((q) => q.status !== 'synced' && now - q.timestamp < STALE_MS);
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

  private loadDismissedLog() {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(DISMISSED_LOG_KEY);
      if (saved) this.dismissedLog = JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse dismissed-item log:', e);
      this.dismissedLog = [];
    }
  }

  private saveDismissedLog() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(DISMISSED_LOG_KEY, JSON.stringify(this.dismissedLog));
    } catch (e) {
      console.error('Failed to save dismissed-item log:', e);
    }
  }

  private logDismissed(items: QueueItem[], reason: DismissedQueueItem['removedReason']) {
    const now = Date.now();
    const entries: DismissedQueueItem[] = items.map((q) => ({ ...q, removedAt: now, removedReason: reason }));
    this.dismissedLog = [...entries, ...this.dismissedLog].slice(0, DISMISSED_LOG_MAX);
    this.saveDismissedLog();
  }

  /** Items removed via dismiss/dismissAll/stale-purge, most recent first — the paper trail for "where did my queued write go." */
  public getDismissedLog(): DismissedQueueItem[] {
    return this.dismissedLog;
  }

  /** Restores the most recently dismissed item (of the given id, or the very latest if omitted) back into the queue as pending. */
  public undoDismiss(id?: string): boolean {
    const idx = id ? this.dismissedLog.findIndex((d) => d.id === id) : 0;
    if (idx === -1 || this.dismissedLog.length === 0) return false;

    const [restored] = this.dismissedLog.splice(idx, 1);
    this.saveDismissedLog();

    const { removedAt, removedReason, ...item } = restored;
    this.queue.push({ ...item, status: 'pending', error: undefined });
    this.notify();
    this.processQueue();
    return true;
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
      item.autoRetryCount = 0; // manual retry resets the auto-retry budget
      this.notify();
      this.processQueue();
    }
  }

  // Callers (UI dismiss buttons) are expected to confirm with the user before
  // calling this — see App.tsx. It no longer hard-deletes: the item is kept
  // in getDismissedLog() and can be restored via undoDismiss().
  public dismiss(id: string): boolean {
    const item = this.queue.find((q) => q.id === id);
    if (!item) return false;

    // Cannot dismiss items that are currently in flight
    if (item.status === 'syncing') {
      return false;
    }

    this.logDismissed([item], 'dismissed');
    this.queue = this.queue.filter((q) => q.id !== id);
    this.notify();
    return true;
  }

  public dismissAll() {
    // Remove all items that are not currently syncing
    const removing = this.queue.filter((q) => q.status !== 'syncing');
    if (removing.length > 0) this.logDismissed(removing, 'dismissed_all');
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
      this.isProcessing = false;

      // Sequential order is still preserved — this retries the SAME item
      // (never skips to the next one), it just no longer requires a human
      // to notice and click Retry for an ordinary transient failure (a
      // dropped connection, a momentary Apps Script cold-start timeout).
      // Previously: one blip silently backlogged every write behind it
      // until someone happened to look at the queue drawer.
      const attempts = (current.autoRetryCount || 0) + 1;
      current.autoRetryCount = attempts;
      this.notify();

      if (attempts <= MAX_AUTO_RETRIES) {
        const backoffMs = RETRY_BACKOFF_MS * Math.pow(2, attempts - 1); // 30s, 60s, 120s, ...
        console.warn(`[Queue Runner] Will auto-retry ${current.id} in ${Math.round(backoffMs / 1000)}s (attempt ${attempts}/${MAX_AUTO_RETRIES})`);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          const stillThere = this.queue.find((q) => q.id === current.id && q.status === 'failed');
          if (stillThere) {
            stillThere.status = 'pending';
            this.notify();
          }
          this.processQueue();
        }, backoffMs);
      } else {
        console.error(`[Queue Runner] ${current.id} failed ${attempts} times — giving up auto-retry, needs manual Retry.`);
      }
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
