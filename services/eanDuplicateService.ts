import { BarcodeProduct } from '../types';
import { getSessionAuthHeaders } from './authToken';

const SESSION_KEY = 'ean_duplicate_session_v1';

export interface DuplicateEanEntry {
  ean: string;
  affectedProducts: Array<{ sku: string; productName: string }>;
  timestamp: string;
  module: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  products: BarcodeProduct[];
}

/** True when EANUPC is the value that would actually get printed (not null/empty/"0"). */
export function isEANUPCSelected(ean?: string): boolean {
  const v = ean?.trim() ?? '';
  return v !== '' && v !== '0';
}

export async function checkEANDuplicate(sku: string): Promise<DuplicateCheckResult> {
  const res = await fetch('/api/barcode/check-ean-duplicates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku }),
  });
  if (!res.ok) throw new Error('Duplicate EAN check failed.');
  return res.json();
}

export function getSessionDuplicates(): DuplicateEanEntry[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function hasSessionDuplicates(): boolean {
  return getSessionDuplicates().length > 0;
}

/** Adds a duplicate entry to the session record (skips if this EAN is already recorded). */
export function recordSessionDuplicate(entry: DuplicateEanEntry): void {
  try {
    const existing = getSessionDuplicates();
    if (existing.some(e => e.ean === entry.ean)) return;
    existing.push(entry);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(existing));
  } catch {
    // sessionStorage unavailable — silent fail, not worth blocking scanning over
  }
}

/**
 * Sends the accumulated session duplicates as one escalation email, then
 * clears the session record. Returns {sent:false} and skips silently if
 * there are no pending duplicates.
 */
export async function sendSessionDuplicateEmail(moduleName: string): Promise<{ sent: boolean }> {
  const duplicates = getSessionDuplicates();
  if (!duplicates.length) return { sent: false };
  try {
    const res = await fetch('/api/barcode/send-duplicate-ean-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSessionAuthHeaders() },
      body: JSON.stringify({ duplicates, module: moduleName }),
    });
    if (!res.ok) {
      console.error('[EANDuplicate] Email send failed:', await res.text());
      return { sent: false };
    }
    sessionStorage.removeItem(SESSION_KEY);
    return { sent: true };
  } catch (err) {
    console.error('[EANDuplicate] Email send error:', err);
    return { sent: false };
  }
}
