// Product master for the Receive Shipment barcode scanner. The catalog lives
// in a separate Google Sheet ("EE Product Master") with its own Apps Script
// deployment (MASTER_BARCODE_SCRIPTS_URL) — NOT part of this app's main
// gas_clone spreadsheet/deployment. That script already exposes:
//   GET  ?action=barcodeProductMaster        -> { data: [ {..raw sheet row..}, ... ] }
//   POST { action: 'get_setting'|'set_setting', key, value? }  (BarcodeAppStore.js,
//         already pasted into that project — shared EAN-alert recipient list)
//   POST { action: 'send_duplicate_ean_email', ... }  (added alongside this feature)
// searchProduct/findDuplicates are done here in Node, on a short-lived cache
// of the whole catalog, mirroring the standalone master-barcode app's
// api/_lib/ProductStore.ts — that project has no server of its own to cache
// in, so it re-fetched per call; this app already has one.

export interface BarcodeProduct {
  sku: string;
  product_name: string;
  mrp: string;
  model_no?: string;
  EANUPC?: string;
  brand?: string;
}

interface CatalogEntry {
  product: BarcodeProduct;
  sku: string;
  productId: string;
  eanUpc: string;
  customEan: string;
  modelNo: string;
}

const CATALOG_TTL_MS = 5 * 60_000;
const EAN_DUPLICATE_EMAILS_KEY = 'ean_duplicate_emails';
const REQUEST_TIMEOUT_MS = 20_000;

function scriptUrl(): string {
  const url = process.env.MASTER_BARCODE_SCRIPTS_URL?.trim();
  if (!url) throw new Error('MASTER_BARCODE_SCRIPTS_URL is not configured.');
  return url;
}

async function callScript<T = any>(opts: { query?: Record<string, string>; payload?: Record<string, unknown> }): Promise<T> {
  const url = new URL(scriptUrl());
  for (const [k, v] of Object.entries(opts.query || {})) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let text: string;
  try {
    const res = await fetch(url.toString(), opts.payload
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(opts.payload), signal: controller.signal }
      : { method: 'GET', signal: controller.signal });
    text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  } catch (err: any) {
    throw new Error(err?.name === 'AbortError'
      ? `Product master script did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
      : `Could not reach product master script: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Product master script returned non-JSON: ${text.slice(0, 200)}`); }
  if (data && data.success === false) throw new Error(data.error || 'Product master script error.');
  return data as T;
}

// Header names differ between the raw sheet export and any future normalized
// form — accept either, same defensive pattern as the standalone app.
function pick(r: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function toEntry(r: any): CatalogEntry | null {
  const sku = pick(r, 'SKU', 'sku');
  if (!sku) return null;
  const eanUpc = pick(r, 'EAN/UPC', 'ean_upc');
  const customEan = pick(r, 'Custom EAN', 'custom_ean');
  const productId = pick(r, 'Product ID', 'product_id');
  const modelNo = pick(r, 'Model No', 'model_no');
  // Prefer Custom EAN as the printed/matched value when set (matches the
  // standalone app's convention — some SKUs override a shared EAN this way).
  const effectiveEan = customEan && customEan !== '0' ? customEan : (eanUpc || undefined);
  return {
    sku, productId, eanUpc, customEan, modelNo,
    product: {
      sku,
      product_name: pick(r, 'Item Name', 'item_name'),
      mrp: pick(r, 'MRP', 'mrp'),
      model_no: modelNo || undefined,
      EANUPC: effectiveEan,
      brand: pick(r, 'Brand', 'brand') || undefined,
    },
  };
}

class ProductMasterStore {
  private cache: CatalogEntry[] | null = null;
  private cacheAt = 0;
  private inflight: Promise<CatalogEntry[]> | null = null;

  private async loadCatalog(): Promise<CatalogEntry[]> {
    if (this.cache && Date.now() - this.cacheAt < CATALOG_TTL_MS) return this.cache;
    if (!this.inflight) {
      this.inflight = (async () => {
        const raw = await callScript<{ data?: any[] }>({ query: { action: 'barcodeProductMaster' } });
        const rows: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
        const bySku = new Map<string, CatalogEntry>();
        for (const r of rows) {
          const entry = toEntry(r);
          if (entry) bySku.set(entry.sku, entry);
        }
        const entries = Array.from(bySku.values());
        this.cache = entries;
        this.cacheAt = Date.now();
        return entries;
      })().finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  /** Force a re-fetch on the next call. */
  invalidate(): void {
    this.cache = null;
    this.cacheAt = 0;
  }

  /** Exact, case-insensitive match on SKU / EAN / Custom EAN / Model No / Product ID — SKU wins. */
  async searchProduct(identifier: string): Promise<BarcodeProduct | null> {
    const q = identifier.trim().toLowerCase();
    if (!q) return null;
    const entries = await this.loadCatalog();
    const hit =
      entries.find(e => e.sku.toLowerCase() === q) ||
      entries.find(e =>
        e.eanUpc.toLowerCase() === q ||
        e.customEan.toLowerCase() === q ||
        e.modelNo.toLowerCase() === q ||
        e.productId.toLowerCase() === q);
    return hit ? hit.product : null;
  }

  /**
   * A SKU conflicts with another when one's EAN/UPC equals the other's Custom
   * EAN and the two SKUs differ in their first 7 characters (same-family SKUs
   * sharing an EAN are expected, e.g. color variants). Returns the SKU plus
   * every SKU it conflicts with, or [] when there's no conflict.
   */
  async findDuplicates(sku: string): Promise<BarcodeProduct[]> {
    const entries = await this.loadCatalog();
    const target = entries.find(e => e.sku === sku);
    if (!target) return [];
    const prefix = sku.slice(0, 7);
    const conflicts = entries.filter(e =>
      e.sku !== sku &&
      e.sku.slice(0, 7) !== prefix &&
      ((target.eanUpc && e.customEan === target.eanUpc) ||
       (target.customEan && e.eanUpc === target.customEan)));
    return conflicts.length ? [target.product, ...conflicts.map(e => e.product)] : [];
  }

  async getSettings(): Promise<{ eanDuplicateEmails: string[] }> {
    try {
      const res = await callScript<{ value: unknown }>({ payload: { action: 'get_setting', key: EAN_DUPLICATE_EMAILS_KEY } });
      return Array.isArray(res.value) ? { eanDuplicateEmails: res.value.map(String) } : { eanDuplicateEmails: [] };
    } catch (err) {
      console.error('[ProductMasterStore] getSettings failed:', err);
      return { eanDuplicateEmails: [] };
    }
  }

  async saveSettings(eanDuplicateEmails: string[]): Promise<void> {
    await callScript({ payload: { action: 'set_setting', key: EAN_DUPLICATE_EMAILS_KEY, value: eanDuplicateEmails } });
  }

  async sendDuplicateEanEmail(duplicates: Array<{ ean: string; affectedProducts: Array<{ sku: string; productName: string }> }>, moduleName: string): Promise<void> {
    await callScript({ payload: { action: 'send_duplicate_ean_email', duplicates, module: moduleName } });
  }
}

export const productMasterStore = new ProductMasterStore();
