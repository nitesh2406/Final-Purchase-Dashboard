import { APPS_SCRIPT_URL } from '../constants';
import { getSessionAuthHeaders } from './authToken';

// ─────────────────────────────────────────────────────────────
// Shared response handling for both callGas and callGasAuthed below.
//
// Root cause of the "Unexpected token '<', <!DOCTYPE... is not valid JSON"
// errors users hit constantly: Apps Script platform-level failures (the
// 6-minute execution timeout, the per-script concurrent-execution quota,
// response size limits) return Google's own HTML error page, which every
// call site used to hand straight to response.json() with no defense.
// parseGasResponse_ always reads as text first and never lets a JSON.parse
// SyntaxError escape to the caller — it throws a clean, readable Error
// instead, whether or not the raw text happens to look like an HTML page.
// ─────────────────────────────────────────────────────────────

class GasResponseError extends Error {
  // True only for failures where the request either never reached the
  // backend or was rejected before any handler ran (network failure, or a
  // response that isn't JSON at all) — i.e. safe to retry a read against.
  // A write should never be retried on this alone: an execution-timeout
  // HTML page can mean the handler ran partway through before Apps Script
  // killed it, so blindly resending could duplicate whatever it did.
  retryableAsRead: boolean;
  constructor(message: string, retryableAsRead: boolean) {
    super(message);
    this.retryableAsRead = retryableAsRead;
  }
}

async function parseGasResponse_(response: Response): Promise<any> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (!response.ok) {
      throw new GasResponseError(
        parsed?.error || parsed?.message || `Request failed (${response.status})`,
        response.status >= 500 || response.status === 429
      );
    }
    return parsed;
  } catch (err) {
    if (err instanceof GasResponseError) throw err;
    // JSON.parse failed — this is the DOCTYPE case (or any other non-JSON
    // body). The backend may or may not have actually run; treat it as
    // retryable only for reads, never assume a write didn't happen.
    throw new GasResponseError(
      'The server took too long to respond or is temporarily overloaded. Please try again in a moment.',
      true
    );
  }
}

const sleep_ = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// One request attempt, optionally bounded by `timeoutMs` (covering the body
// read as well as the headers). Without a limit a stalled Apps Script call
// leaves the caller waiting until Google gives up — measured at 180s on a
// call that normally takes 5s. On timeout the request is aborted and a
// retryable-as-read error is thrown, so `retries` on a read then gets its
// chance. Opt-in per call site: an arbitrary cap would abort legitimately slow
// reads elsewhere, and a timed-out WRITE may still have run — never set this
// on anything that writes.
async function timedAttempt_(url: string, init: RequestInit, timeoutMs: number | undefined): Promise<any> {
  if (!timeoutMs) return parseGasResponse_(await fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await parseGasResponse_(await fetch(url, { ...init, signal: controller.signal }));
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new GasResponseError(
        `No response after ${Math.round(timeoutMs / 1000)}s — the server is slow or overloaded. Please try again.`,
        true
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// retries: number of ADDITIONAL attempts after the first, only ever used
// for GasResponseError with retryableAsRead=true (never for a write — pass
// retries: 0, the default, for any action that creates/updates/deletes
// anything). A plain network-level throw (fetch itself rejecting, e.g. the
// connection dropping before any response arrived) is also retried since
// no request can have reached the backend in that case.
async function withGasRetry_<T>(attempt: () => Promise<T>, retries: number): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      const canRetry = err instanceof GasResponseError ? err.retryableAsRead : true;
      if (!canRetry || i === retries) throw err;
      await sleep_(600 * (i + 1));
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────
// Shared read cache for the dataset reads that several screens make
// independently (Finance loads PurchaseInvoices/SettlementLedger, and so do
// CNF Advances, CNF Agent Accounting and Batch Detail). Every Apps Script
// call costs ~3-4s however small its response, so the same request going out
// from three screens is pure lag.
//
//  - an identical request already in flight is shared, not re-sent;
//  - a SUCCESSFUL response is reused for READ_CACHE_TTL_MS (failures are
//    never cached, so a blip can't get stuck on screen);
//  - ANY write through callGas/callGasAuthed/executeAppsScriptProxy clears
//    the whole cache, so a post-write refresh always reads the new data. A
//    read already in flight when the write happens is not stored either
//    (the generation counter), since it may predate the write.
// Each caller gets its own deep copy, so one screen mutating a response can
// never leak into another's. Another user's writes show up within the TTL,
// or immediately on a screen's Refresh (force: true).
// ─────────────────────────────────────────────────────────────

const READ_CACHE_TTL_MS = 60 * 1000;

const CACHEABLE_READ_ACTIONS = new Set([
  'get_drafts', 'get_pos', 'get_vendor_masters',
  'get_purchase_invoices', 'get_payment_logs', 'get_settlement_records', 'get_vendor_ledger',
  'get_vendor_shipments',
  'get_cnf_eligible_batches', 'get_cnf_advances', 'get_cnf_goods_invoices', 'get_cnf_ledger',
  'get_cnf_invoice_batches', 'get_cnf_shipment_bill_status', 'get_batches',
  'get_product_master',
]);

// Actions that only read. Anything else is treated as a write and clears the
// read cache — erring toward clearing is safe (costs one refetch), erring the
// other way would serve stale data after a write.
const isReadAction_ = (action: string) => /^(get|search|verify|ping|fetch)/i.test(action);

type ReadCacheEntry = { value?: any; fetchedAt: number; inflight?: Promise<any> };
const readCache_ = new Map<string, ReadCacheEntry>();
let readCacheGeneration_ = 0;

export function invalidateReadCache(): void {
  readCacheGeneration_++;
  readCache_.clear();
}

const isSuccessResponse_ = (r: any) => !!r && (r.status === 'success' || r.success === true);

const clone_ = <T,>(v: T): T => (v === undefined ? v : (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))));

// Data-load failures used to be swallowed by the fetch* wrappers in
// settlementService.ts, which then showed a browser-saved copy or an empty
// list with no sign anything went wrong. Every failed dataset read is now
// reported here; App.tsx renders a banner while any is outstanding, and a
// later successful read of the same action clears it.
export type DataLoadError = { action: string; message: string; at: number };
const dataLoadErrors_ = new Map<string, DataLoadError>();
const dataErrorListeners_ = new Set<(errors: DataLoadError[]) => void>();

function emitDataErrors_() {
  const list = Array.from(dataLoadErrors_.values());
  dataErrorListeners_.forEach(cb => cb(list));
}

export function subscribeDataLoadErrors(cb: (errors: DataLoadError[]) => void): () => void {
  dataErrorListeners_.add(cb);
  cb(Array.from(dataLoadErrors_.values()));
  return () => { dataErrorListeners_.delete(cb); };
}

export function clearDataLoadErrors(): void {
  dataLoadErrors_.clear();
  emitDataErrors_();
}

function recordReadOutcome_(action: string, error: string | null) {
  if (error) {
    dataLoadErrors_.set(action, { action, message: error, at: Date.now() });
  } else if (!dataLoadErrors_.has(action)) {
    return;
  } else {
    dataLoadErrors_.delete(action);
  }
  emitDataErrors_();
}

async function throughReadCache_(
  channel: string, action: string, payload: Record<string, any>, force: boolean, send: () => Promise<any>
): Promise<any> {
  if (!CACHEABLE_READ_ACTIONS.has(action)) {
    if (isReadAction_(action)) return send();
    // A write — clear cached reads once it's done, whatever the outcome: a
    // write that errored or timed out may still have run server-side.
    try {
      return await send();
    } finally {
      invalidateReadCache();
    }
  }
  const key = channel + '|' + action + '|' + JSON.stringify(payload);
  const existing = readCache_.get(key);
  if (!force && existing) {
    if (existing.inflight) return clone_(await existing.inflight);
    if (existing.value !== undefined && Date.now() - existing.fetchedAt < READ_CACHE_TTL_MS) return clone_(existing.value);
  }
  const generation = readCacheGeneration_;
  const inflight = send().then(
    result => {
      const ok = isSuccessResponse_(result);
      if (generation === readCacheGeneration_) {
        if (ok) readCache_.set(key, { value: result, fetchedAt: Date.now() });
        else readCache_.delete(key);
      }
      recordReadOutcome_(action, ok ? null : (result?.message || result?.error || 'Request failed'));
      return result;
    },
    err => {
      if (generation === readCacheGeneration_) readCache_.delete(key);
      recordReadOutcome_(action, err?.message || String(err));
      throw err;
    }
  );
  readCache_.set(key, { value: existing?.value, fetchedAt: existing?.fetchedAt ?? 0, inflight });
  return clone_(await inflight);
}

// A successful Apps Script response always carries `status` or `success`.
// One without either is one of Google's intermittent redirect glitches (seen
// live: a POST answered with the doGet default output) — treat it as a
// retryable failure rather than handing it to a screen as data.
const hasEnvelope_ = (r: any) => !!r && typeof r === 'object' && ('status' in r || 'success' in r);

function assertEnvelope_(r: any): any {
  if (!hasEnvelope_(r)) {
    throw new GasResponseError('The server returned an unexpected response. Please try again.', true);
  }
  return r;
}

// ─────────────────────────────────────────────────────────────
// Request grouping. Opening a screen fires ~10-15 reads at once (startup
// data + the screen's own datasets); Apps Script runs them concurrently and
// they slow each other down badly — measured 36-38s each, versus ~5s for the
// same read alone. Cacheable direct reads issued in the same instant are
// therefore queued for one tick and sent as a single `get_bundle` request
// (see getBundle_ in gas_clone/entry_points.js), which runs them one after
// another in one execution. Callers are unaware — each still gets its own
// result. If the bundle fails as a whole, or one item comes back malformed,
// those reads fall back to being sent individually, exactly as before.
// ─────────────────────────────────────────────────────────────

type BundleItem = { req: Record<string, any>; resolve: (v: any) => void; reject: (e: any) => void; sendAlone: () => Promise<any> };
let pendingBundle_: BundleItem[] = [];
let bundleTimer_: ReturnType<typeof setTimeout> | null = null;
const MAX_BUNDLE_SIZE = 30; // matches the backend's limit
const BUNDLE_TIMEOUT_MS = 90 * 1000;

function bundledSend_(req: Record<string, any>, sendAlone: () => Promise<any>): Promise<any> {
  return new Promise((resolve, reject) => {
    pendingBundle_.push({ req, resolve, reject, sendAlone });
    if (!bundleTimer_) bundleTimer_ = setTimeout(flushBundle_, 0);
  });
}

function flushBundle_() {
  bundleTimer_ = null;
  const items = pendingBundle_;
  pendingBundle_ = [];
  for (let i = 0; i < items.length; i += MAX_BUNDLE_SIZE) {
    runBundle_(items.slice(i, i + MAX_BUNDLE_SIZE));
  }
}

async function runBundle_(items: BundleItem[]) {
  const sendAlone = (item: BundleItem) => item.sendAlone().then(item.resolve, item.reject);
  if (items.length === 1) {
    sendAlone(items[0]);
    return;
  }
  let results: any[] | null = null;
  try {
    const response = await withGasRetry_(() => timedAttempt_(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'get_bundle', requests: items.map(i => i.req) })
    }, BUNDLE_TIMEOUT_MS).then(r => {
      if (!r || r.status !== 'success' || !Array.isArray(r.results) || r.results.length !== items.length) {
        throw new GasResponseError('Malformed bundle response', true);
      }
      return r;
    }), 1);
    results = response.results;
  } catch (err) {
    console.warn('[gasApi] get_bundle failed — sending its reads individually', err);
  }
  items.forEach((item, idx) => {
    const r = results?.[idx];
    if (hasEnvelope_(r)) item.resolve(r);
    else sendAlone(item);
  });
}

// Dataset reads get a bounded wait by default so a stalled Apps Script call can't
// hang a screen for minutes (measured at 180s — see timedAttempt_). Generous
// on purpose: some reads legitimately take 20s+ when Apps Script is busy.
const DEFAULT_READ_TIMEOUT_MS = 60 * 1000;

// Calls the GAS backend directly (unauthenticated) — the pattern almost
// every screen used to hand-rolled via `fetch(APPS_SCRIPT_URL, ...)` +
// `response.json()`. Same request/response shape as that old pattern (the
// resolved value is the parsed JSON body), so call sites migrate by
// swapping the fetch+json boilerplate for `await callGas(action, payload)`
// without touching their `result.success` / `result.data` handling.
//
// Pass `retries` > 0 ONLY for read/list/get actions. Leave it at 0 (default)
// for anything that writes — see GasResponseError.retryableAsRead above.
//
// `timeoutMs` (optional, reads only — see timedAttempt_) aborts an attempt
// that hasn't completed in time; combined with `retries` the read is retried.
//
// `opts.force` bypasses the shared read cache (see throughReadCache_) — use it
// for an explicit user Refresh. Reads with no `timeoutMs` get
// DEFAULT_READ_TIMEOUT_MS when they are cached dataset reads (timed at
// <30s); other reads and all writes keep no implicit timeout.
export async function callGas(action: string, payload: Record<string, any> = {}, retries = 0, timeoutMs?: number, opts: { force?: boolean } = {}): Promise<any> {
  const body = JSON.stringify({ action, ...payload });
  const isDataset = CACHEABLE_READ_ACTIONS.has(action);
  const effectiveTimeout = timeoutMs ?? (isDataset ? DEFAULT_READ_TIMEOUT_MS : undefined);
  // Dataset reads are always safe to retry, and are checked for the
  // success envelope so a redirect glitch gets retried, not displayed.
  const sendAlone = () => withGasRetry_(() => timedAttempt_(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  }, effectiveTimeout).then(r => (isDataset ? assertEnvelope_(r) : r)), isDataset ? Math.max(retries, 1) : retries);
  return throughReadCache_('direct', action, payload, !!opts.force,
    isDataset ? () => bundledSend_({ action, ...payload }, sendAlone) : sendAlone);
}

// Calls the GAS backend through /api/apps-script-proxy instead of hitting
// APPS_SCRIPT_URL directly. The proxy (server/app.ts) requires a valid
// session token (requireSession) and stamps the session-verified email onto
// the outgoing payload as user_email, overwriting anything passed here — so
// a caller can't spoof who they are just by editing this payload. Used by
// the Shipment Tracker/Finance merge, where the backend needs to trust the
// caller's identity to decide whether to include finance fields.
//
// Other screens still call APPS_SCRIPT_URL directly (unauthenticated) —
// this helper is scoped to the calls that actually need a verified identity,
// not a blanket replacement.
//
// Same retry contract as callGas: pass `retries` > 0 only for reads.
export async function callGasAuthed(action: string, payload: Record<string, any> = {}, retries = 0, timeoutMs?: number, opts: { force?: boolean } = {}): Promise<any> {
  const innerBody = JSON.stringify({ action, ...payload });
  const effectiveTimeout = timeoutMs ?? (CACHEABLE_READ_ACTIONS.has(action) ? DEFAULT_READ_TIMEOUT_MS : undefined);
  // 'authed' channel: the proxy stamps the caller's verified email, so the
  // same action can legitimately return different data than a direct call.
  return throughReadCache_('authed', action, payload, !!opts.force, () => withGasRetry_(() => timedAttempt_('/api/apps-script-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getSessionAuthHeaders()
    },
    body: JSON.stringify({
      url: APPS_SCRIPT_URL,
      method: 'POST',
      body: innerBody
    })
  }, effectiveTimeout).then(r => (CACHEABLE_READ_ACTIONS.has(action) ? assertEnvelope_(r) : r)),
  CACHEABLE_READ_ACTIONS.has(action) ? Math.max(retries, 1) : retries));
}
