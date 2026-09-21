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
export async function callGas(action: string, payload: Record<string, any> = {}, retries = 0, timeoutMs?: number): Promise<any> {
  const body = JSON.stringify({ action, ...payload });
  return withGasRetry_(() => timedAttempt_(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  }, timeoutMs), retries);
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
export async function callGasAuthed(action: string, payload: Record<string, any> = {}, retries = 0, timeoutMs?: number): Promise<any> {
  const innerBody = JSON.stringify({ action, ...payload });
  return withGasRetry_(() => timedAttempt_('/api/apps-script-proxy', {
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
  }, timeoutMs), retries);
}
